"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// أرشيف ZIP مدمج بلا تبعيات خارجية (يستخدم node:zlib deflate + CRC32 يدوي).
// يُستخدم لتغليف نسخة قاعدة البيانات مع مجلد /uploads في ملف واحد قابل للفتح
// بأي أداة (7-Zip/WinRAR/unzip) وقابل للاستعادة عبر scripts/restore.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_DEFLATE = 8;
// جدول CRC32 (معكوس البتات بلا قيم أولية)
let CRC_TABLE = null;
function crcTable() {
    if (CRC_TABLE)
        return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
}
function crc32(buf) {
    const table = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
// تطبيع أسماء المسارات داخل الأرشيف: فواصل '/' وبدون ".." أو جذر مطلق
function normalizeEntry(name) {
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = clean.split('/').filter((p) => p && p !== '.' && p !== '..');
    return parts.join('/');
}
function dosTime(date) {
    const t = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | (date.getUTCSeconds() >> 1);
    const d = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    return { t, d };
}
// إنشاء أرشيف من قائمة { name, data (Buffer) | file (مسار) }
function createZip(entries, { level = 6, mtime = new Date() } = {}) {
    const table = crcTable();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const raw of entries) {
        const name = normalizeEntry(raw.name);
        if (!name)
            continue;
        const data = raw.data || fs.readFileSync(raw.file);
        const crc = crc32(data);
        const compressed = data.length > 0
            ? zlib.deflateRawSync(data, { level })
            : Buffer.alloc(0);
        const { t, d } = dosTime(mtime);
        const nameBuf = Buffer.from(name, 'utf8');
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(SIG_LOCAL, 0);
        localHeader.writeUInt16LE(20, 4); // version needed
        localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8
        localHeader.writeUInt16LE(METHOD_DEFLATE, 8);
        localHeader.writeUInt16LE(t, 10);
        localHeader.writeUInt16LE(d, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28); // extra len
        localParts.push(localHeader, nameBuf, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(SIG_CENTRAL, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(METHOD_DEFLATE, 10);
        central.writeUInt16LE(t, 12);
        central.writeUInt16LE(d, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30); // extra len
        central.writeUInt16LE(0, 32); // comment len
        central.writeUInt16LE(0, 34); // disk start
        central.writeUInt16LE(0, 36); // internal attrs
        central.writeUInt32LE(0, 38); // external attrs
        central.writeUInt32LE(offset, 42); // local header offset
        centralParts.push(central, nameBuf);
        offset += localHeader.length + nameBuf.length + compressed.length;
    }
    const centralBuf = Buffer.concat(centralParts.map((p) => (Buffer.isBuffer(p) ? p : p)));
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralBuf, eocd]);
}
// قراءة فهرس الأرشيف (يُستخدم للاستعادة)
function readCentral(zip) {
    // EOCD: آخر 22+65535 بايت
    const tailStart = Math.max(0, zip.length - (22 + 65535));
    let eocdPos = -1;
    for (let i = zip.length - 22; i >= tailStart; i--) {
        if (zip.readUInt32LE(i) === SIG_EOCD) {
            eocdPos = i;
            break;
        }
    }
    if (eocdPos < 0)
        throw new Error('أرشيف غير صالح: EOCD غير موجود');
    const entryCount = zip.readUInt16LE(eocdPos + 10);
    const cdSize = zip.readUInt32LE(eocdPos + 12);
    const cdOffset = zip.readUInt32LE(eocdPos + 16);
    const out = [];
    let pos = cdOffset;
    const end = cdOffset + cdSize;
    while (pos < end && out.length < entryCount) {
        if (zip.readUInt32LE(pos) !== SIG_CENTRAL)
            throw new Error('أرشيف غير صالح: سجل مركزي خاطئ');
        const nameLen = zip.readUInt16LE(pos + 28);
        const extraLen = zip.readUInt16LE(pos + 30);
        const commentLen = zip.readUInt16LE(pos + 32);
        const localOffset = zip.readUInt32LE(pos + 42);
        const method = zip.readUInt16LE(pos + 10);
        const crc = zip.readUInt32LE(pos + 16);
        const csize = zip.readUInt32LE(pos + 20);
        const usize = zip.readUInt32LE(pos + 24);
        const name = zip.toString('utf8', pos + 46, pos + 46 + nameLen);
        out.push({ name, method, crc, csize, usize, localOffset });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}
function extractEntry(zip, entry) {
    const local = entry.localOffset;
    if (zip.readUInt32LE(local) !== SIG_LOCAL)
        throw new Error('أرشيف غير صالح: سجل محلي خاطئ');
    const nameLen = zip.readUInt16LE(local + 26);
    const extraLen = zip.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLen + extraLen;
    const raw = zip.subarray(dataStart, dataStart + entry.csize);
    const data = entry.method === 0 ? raw : zlib.inflateRawSync(raw);
    if (data.length !== entry.usize)
        throw new Error('أرشيف غير صالح: حجم البيانات لا يطابق');
    if (crc32(data) !== entry.crc)
        throw new Error('أرشيف غير صالح: CRC لا يطابق (ملف تالف)');
    return data;
}
// استخراج كامل إلى مجلد، مع حماية من اجتياز المسار
function extractZip(zip, destDir) {
    const root = path.resolve(destDir);
    const written = [];
    for (const entry of readCentral(zip)) {
        const rel = normalizeEntry(entry.name);
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep))
            throw new Error('إدخال غير آمن في الأرشيف: ' + entry.name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, extractEntry(zip, entry));
        written.push(abs);
    }
    return written;
}
module.exports = { createZip, extractZip, readCentral, crc32 };
