const { get, all, run } = require('../db');
const { ApiError, toId } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

function listGovernorates(active) {
  const rows = active !== undefined
    ? all('SELECT * FROM governorates WHERE is_active = ? ORDER BY sort_order ASC', [Number(active) ? 1 : 0])
    : all('SELECT * FROM governorates ORDER BY sort_order ASC');

  return rows.map((g) => {
    const agent = get(
      `SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
              u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
       FROM agents a JOIN users u ON u.id = a.user_id WHERE a.governorate_id = ?`,
      [g.id]
    );
    const providersCount = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [g.id]).c;
    return { ...g, agent, providers_count: providersCount };
  });
}

function getGovernorate(id) {
  id = toId(id);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
  if (!gov) throw new ApiError(404, 'المحافظة غير موجودة');
  const agentsCount = get('SELECT COUNT(*) AS c FROM agents WHERE governorate_id = ?', [id]).c;
  const providersCount = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [id]).c;
  const agent = get(
    `SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
            u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
     FROM agents a JOIN users u ON u.id = a.user_id WHERE a.governorate_id = ?`,
    [id]
  );
  return { ...gov, agents_count: agentsCount, providers_count: providersCount, agent };
}

function createGovernorate(body, actor) {
  const { name_ar, name_en, code, lease_fee = 0, is_active = 1, sort_order = 0 } = body || {};
  if (!name_ar || !name_en || !code) throw new ApiError(400, 'يرجى ملء جميع الحقول المطلوبة (الاسم عربي، إنجليزي+، الرمز)');
  const dup = get('SELECT id FROM governorates WHERE code = ?', [String(code).toUpperCase()]);
  if (dup) throw new ApiError(409, 'رمز المحافظة مستخدم مسبقاً');

  const id = run(
    'INSERT INTO governorates (name_ar, name_en, code, lease_fee, is_active, sort_order) VALUES (?,?,?,?,?,?)',
    [name_ar, name_en, String(code).toUpperCase(), Number(lease_fee) || 0, Number(is_active) ? 1 : 0, Number(sort_order) || 0]
  ).lastId;
  logActivity(actor, 'create', 'governorate', id, { name_ar });
  return get('SELECT * FROM governorates WHERE id = ?', [id]);
}

function updateGovernorate(id, body, actor) {
  id = toId(id);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
  if (!gov) throw new ApiError(404, 'المحافظة غير موجودة');

  const { name_ar, name_en, code, lease_fee, is_active, sort_order } = body || {};
  if (code) {
    const dup = get('SELECT id FROM governorates WHERE code = ? AND id != ?', [String(code).toUpperCase(), id]);
    if (dup) throw new ApiError(409, 'رمز المحافظة مستخدم مسبقاً');
  }

  run(
    'UPDATE governorates SET name_ar = ?, name_en = ?, code = ?, lease_fee = ?, is_active = ?, sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [
      name_ar !== undefined ? name_ar : gov.name_ar,
      name_en !== undefined ? name_en : gov.name_en,
      code !== undefined ? String(code).toUpperCase() : gov.code,
      lease_fee !== undefined ? Number(lease_fee) || 0 : gov.lease_fee,
      is_active !== undefined ? (Number(is_active) ? 1 : 0) : gov.is_active,
      sort_order !== undefined ? Number(sort_order) || 0 : gov.sort_order,
      id,
    ]
  );
  logActivity(actor, 'update', 'governorate', id, { name_ar });
  return get('SELECT * FROM governorates WHERE id = ?', [id]);
}

function deleteGovernorate(id, actor) {
  id = toId(id);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
  if (!gov) throw new ApiError(404, 'المحافظة غير موجودة');

  const agents = get('SELECT COUNT(*) AS c FROM agents WHERE governorate_id = ?', [id]).c;
  const providers = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [id]).c;
  if (agents > 0 || providers > 0) {
    throw new ApiError(409, 'لا يمكن حذف المحافظة لوجود وكلاء أو مزودي خدمة مرتبطين بها، يمكنك إيقافها بدلاً من ذلك');
  }
  run('DELETE FROM governorates WHERE id = ?', [id]);
  logActivity(actor, 'delete', 'governorate', id, { name_ar: gov.name_ar });
  return { message: 'تم حذف المحافظة بنجاح' };
}

function toggleGovernorate(id, actor) {
  id = toId(id);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
  if (!gov) throw new ApiError(404, 'المحافظة غير موجودة');
  run('UPDATE governorates SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [gov.is_active ? 0 : 1, id]);
  logActivity(actor, gov.is_active ? 'deactivate' : 'activate', 'governorate', id);
  return get('SELECT * FROM governorates WHERE id = ?', [id]);
}

module.exports = { listGovernorates, getGovernorate, createGovernorate, updateGovernorate, deleteGovernorate, toggleGovernorate };
