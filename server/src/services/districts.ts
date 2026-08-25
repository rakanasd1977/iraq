const { get, all, run } = require('../db');
const { ApiError, toId } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

function listDistricts(query) {
  const { q, governorate_id, active } = query || {};
  const params = [];
  const conds = [];
  if (governorate_id) {
    conds.push('d.governorate_id = ?');
    params.push(Number(governorate_id));
  }
  if (active !== undefined && active !== '') {
    conds.push('d.is_active = ?');
    params.push(Number(active) ? 1 : 0);
  }
  if (q) {
    const like = `%${q}%`;
    conds.push('(d.name_ar LIKE ? OR d.name_en LIKE ? OR d.code LIKE ?)');
    params.push(like, like, like);
  }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const rows = all(
    `SELECT d.*, g.name_ar AS governorate_name_ar, g.code AS governorate_code
     FROM districts d
     JOIN governorates g ON g.id = d.governorate_id
     ${where}
     ORDER BY g.sort_order ASC, d.sort_order ASC, d.name_ar ASC`,
    params
  );
  return rows.map((d) => {
    const agent = get(
      `SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
              u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
       FROM agents a JOIN users u ON u.id = a.user_id WHERE a.district_id = ?`,
      [d.id]
    );
    return { ...d, agent: agent || null };
  });
}

function getDistrict(id) {
  id = toId(id);
  const d = get(
    `SELECT d.*, g.name_ar AS governorate_name_ar, g.code AS governorate_code
     FROM districts d JOIN governorates g ON g.id = d.governorate_id WHERE d.id = ?`,
    [id]
  );
  if (!d) throw new ApiError(404, 'القضاء غير موجود');
  const agentsCount = get('SELECT COUNT(*) AS c FROM agents WHERE district_id = ?', [id]).c;
  const agent = get(
    `SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
            u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
     FROM agents a JOIN users u ON u.id = a.user_id WHERE a.district_id = ?`,
    [id]
  );
  return { ...d, agents_count: agentsCount, agent: agent || null };
}

function createDistrict(body, actor) {
  const { name_ar, name_en, code, governorate_id, lease_fee = 0, is_active = 1, lat, lng, sort_order = 0 } = body || {};
  if (!name_ar || !name_en || !code || !governorate_id) {
    throw new ApiError(400, 'يرجى ملء جميع الحقول المطلوبة (الاسم عربي+، الإنجليزي+، الرمز+، المحافظة)');
  }
  const gov = get('SELECT id FROM governorates WHERE id = ?', [Number(governorate_id)]);
  if (!gov) throw new ApiError(400, 'المحافظة غير موجودة');
  const dup = get('SELECT id FROM districts WHERE governorate_id = ? AND code = ?', [gov.id, String(code).toUpperCase()]);
  if (dup) throw new ApiError(409, 'رمز القضاء مستخدم مسبقاً في هذه المحافظة');

  const id = run(
    'INSERT INTO districts (governorate_id, name_ar, name_en, code, lease_fee, is_active, lat, lng, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
    [gov.id, name_ar, name_en, String(code).toUpperCase(), Number(lease_fee) || 0, Number(is_active) ? 1 : 0,
      lat !== undefined && lat !== '' ? Number(lat) : null, lng !== undefined && lng !== '' ? Number(lng) : null, Number(sort_order) || 0]
  ).lastId;
  logActivity(actor, 'create', 'district', id, { name_ar });
  return get('SELECT * FROM districts WHERE id = ?', [id]);
}

function updateDistrict(id, body, actor) {
  id = toId(id);
  const d = get('SELECT * FROM districts WHERE id = ?', [id]);
  if (!d) throw new ApiError(404, 'القضاء غير موجود');

  const { name_ar, name_en, code, governorate_id, lease_fee, is_active, lat, lng, sort_order } = body || {};
  if (code) {
    const dup = get('SELECT id FROM districts WHERE governorate_id = ? AND code = ? AND id != ?', [d.governorate_id, String(code).toUpperCase(), id]);
    if (dup) throw new ApiError(409, 'رمز القضاء مستخدم مسبقاً في هذه المحافظة');
  }
  const govId = governorate_id !== undefined ? Number(governorate_id) : d.governorate_id;
  if (governorate_id) {
    const gov = get('SELECT id FROM governorates WHERE id = ?', [govId]);
    if (!gov) throw new ApiError(400, 'المحافظة غير موجودة');
  }

  run(
    `UPDATE districts SET name_ar = ?, name_en = ?, code = ?, governorate_id = ?, lease_fee = ?, is_active = ?, lat = ?, lng = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      name_ar !== undefined ? name_ar : d.name_ar,
      name_en !== undefined ? name_en : d.name_en,
      code !== undefined ? String(code).toUpperCase() : d.code,
      govId,
      lease_fee !== undefined ? Number(lease_fee) || 0 : d.lease_fee,
      is_active !== undefined ? (Number(is_active) ? 1 : 0) : d.is_active,
      lat !== undefined ? (lat === '' || lat === null ? null : Number(lat)) : d.lat,
      lng !== undefined ? (lng === '' || lng === null ? null : Number(lng)) : d.lng,
      sort_order !== undefined ? Number(sort_order) || 0 : d.sort_order,
      id,
    ]
  );
  logActivity(actor, 'update', 'district', id, { name_ar });
  return get('SELECT * FROM districts WHERE id = ?', [id]);
}

function deleteDistrict(id, actor) {
  id = toId(id);
  const d = get('SELECT * FROM districts WHERE id = ?', [id]);
  if (!d) throw new ApiError(404, 'القضاء غير موجود');

  const agents = get('SELECT COUNT(*) AS c FROM agents WHERE district_id = ?', [id]).c;
  if (agents > 0) {
    throw new ApiError(409, 'لا يمكن حذف القضاء لوجود وكيل مرتبط به، يمكنك إيقافه بدلاً من ذلك');
  }
  run('DELETE FROM districts WHERE id = ?', [id]);
  logActivity(actor, 'delete', 'district', id, { name_ar: d.name_ar });
  return { message: 'تم حذف القضاء بنجاح' };
}

function toggleDistrict(id, actor) {
  id = toId(id);
  const d = get('SELECT * FROM districts WHERE id = ?', [id]);
  if (!d) throw new ApiError(404, 'القضاء غير موجود');
  run('UPDATE districts SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [d.is_active ? 0 : 1, id]);
  logActivity(actor, d.is_active ? 'deactivate' : 'activate', 'district', id);
  return get('SELECT * FROM districts WHERE id = ?', [id]);
}

module.exports = { listDistricts, getDistrict, createDistrict, updateDistrict, deleteDistrict, toggleDistrict };
