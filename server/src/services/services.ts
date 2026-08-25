const { get, all, run } = require('../db');
const { ApiError, toId } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

function validRate(value) {
  if (value === null || value === undefined || value === '') return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function normalizeRate(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

function resolveRate(serviceRate, providerRate) {
  if (serviceRate !== null && serviceRate !== undefined) return Number(serviceRate);
  return Number(providerRate) || 0;
}

function listServices() {
  const rows = all('SELECT * FROM services ORDER BY sort_order ASC');
  return rows.map((s) => {
    s.providers_count = get('SELECT COUNT(*) AS c FROM providers WHERE service_id = ?', [s.id]).c;
    return s;
  });
}

function createService(body, actor) {
  const { slug, name_ar, name_en, description, icon, is_active = 1, sort_order = 0, commission_rate } = body || {};
  if (!slug || !name_ar || !name_en) throw new ApiError(400, 'يرجى ملء الحقول المطلوبة');
  const dup = get('SELECT id FROM services WHERE slug = ?', [String(slug).toLowerCase()]);
  if (dup) throw new ApiError(409, 'رمز الخدمة مستخدم مسبقاً');
  if (!validRate(commission_rate)) throw new ApiError(400, 'نسبة عمولة الخدمة يجب أن تكون رقماً بين 0 و 100 أو تُترك فارغة لاستخدام الافتراضي');

  const id = run(
    'INSERT INTO services (slug, name_ar, name_en, description, icon, is_active, sort_order, commission_rate) VALUES (?,?,?,?,?,?,?,?)',
    [String(slug).toLowerCase(), name_ar, name_en, description || null, icon || null, Number(is_active) ? 1 : 0, Number(sort_order) || 0, normalizeRate(commission_rate)]
  ).lastId;
  logActivity(actor, 'create', 'service', id, { name_ar });
  return get('SELECT * FROM services WHERE id = ?', [id]);
}

function updateService(id, body, actor) {
  id = toId(id);
  const svc = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!svc) throw new ApiError(404, 'الخدمة غير موجودة');

  const { slug, name_ar, name_en, description, icon, is_active, sort_order, commission_rate } = body || {};
  if (slug) {
    const dup = get('SELECT id FROM services WHERE slug = ? AND id != ?', [String(slug).toLowerCase(), id]);
    if (dup) throw new ApiError(409, 'رمز الخدمة مستخدم مسبقاً');
  }
  if (commission_rate !== undefined && !validRate(commission_rate)) throw new ApiError(400, 'نسبة عمولة الخدمة يجب أن تكون رقماً بين 0 و 100 أو تُترك فارغة لاستخدام الافتراضي');

  run(
    'UPDATE services SET slug = ?, name_ar = ?, name_en = ?, description = ?, icon = ?, is_active = ?, sort_order = ?, commission_rate = ? WHERE id = ?',
    [
      slug !== undefined ? String(slug).toLowerCase() : svc.slug,
      name_ar !== undefined ? name_ar : svc.name_ar,
      name_en !== undefined ? name_en : svc.name_en,
      description !== undefined ? description : svc.description,
      icon !== undefined ? icon : svc.icon,
      is_active !== undefined ? (Number(is_active) ? 1 : 0) : svc.is_active,
      sort_order !== undefined ? Number(sort_order) || 0 : svc.sort_order,
      commission_rate !== undefined ? normalizeRate(commission_rate) : svc.commission_rate,
      id,
    ]
  );
  logActivity(actor, 'update', 'service', id, { name_ar: name_ar !== undefined ? name_ar : svc.name_ar });
  return get('SELECT * FROM services WHERE id = ?', [id]);
}

function toggleService(id, actor) {
  id = toId(id);
  const svc = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!svc) throw new ApiError(404, 'الخدمة غير موجودة');
  run('UPDATE services SET is_active = ? WHERE id = ?', [svc.is_active ? 0 : 1, id]);
  logActivity(actor, svc.is_active ? 'deactivate' : 'activate', 'service', id);
  return get('SELECT * FROM services WHERE id = ?', [id]);
}

function deleteService(id, actor) {
  id = toId(id);
  const svc = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!svc) throw new ApiError(404, 'الخدمة غير موجودة');
  const providers = get('SELECT COUNT(*) AS c FROM providers WHERE service_id = ?', [id]).c;
  if (providers > 0) {
    throw new ApiError(409, 'لا يمكن حذف الخدمة لوجود مزودي خدمة مرتبطين بها، يمكنك إيقافها بدلاً من ذلك');
  }
  run('DELETE FROM services WHERE id = ?', [id]);
  logActivity(actor, 'delete', 'service', id, { name_ar: svc.name_ar });
  return { message: 'تم حذف الخدمة بنجاح' };
}

module.exports = { listServices, createService, updateService, toggleService, deleteService, validRate, resolveRate };
