"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { get, run } = require('../db');
function ensureWallet(providerId) {
    let w = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [providerId]);
    if (!w) {
        run('INSERT OR IGNORE INTO provider_wallets (provider_id, balance) VALUES (?,0)', [providerId]);
        w = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [providerId]);
    }
    return w;
}
module.exports = { ensureWallet };
