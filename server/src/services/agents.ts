const { get, all, run, transaction } = require('../db');
const { ApiError, toId, nextLeasePeriod, round2, settingValue, paginate, assertLength } = require('../utils/helpers');
const { hashPassword, randomPassword } = require('../utils/password');
const { logActivity } = require('../utils/log');

const AGENT_SELECT = `
  SELECT a.id, a.user_id, a.governorate_id, a.district_id, a.commission_rate, a.lease_status,
         a.lease_expires_at, a.created_at, a.updated_at,
         u.name_ar, u.name_en, u.email, u.phone, u.is_active AS user_active, u.avatar,
         g.name_ar AS governorate_name_ar, g.code AS governorate_code, g.lease_fee,
         d.name_ar AS district_name_ar, d.code AS district_code
  FROM agents a
  JOIN users u ON u.id = a.user_id
  JOIN governorates g ON g.id = a.governorate_id
  LEFT JOIN districts d ON d.id = a.district_id
`;

// يولّد رمزاً فريداً لقضاء جديد ضمن المحافظة (يُستخدم عند إنشاء القضاء تلقائياً من اسم مكتوب)
function genDistrictCode(govId, name) {
  const latin = String(name).normalize('NFKD').replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, '').toUpperCase();
  const base = (latin || `D${govId}`).slice(0, 12);
  let code = base;
  let n = 1;
  while (get('SELECT 1 FROM districts WHERE governorate_id = ? AND code = ?', [govId, code])) {
    code = base.slice(0, 8) + n;
    n += 1;
  }
  return code;
}

// يبحث عن قضاء بنفس الاسم (غير حساس لحالة الأحرف) ضمن المحافظة، فإن لم يوجد يُنشئه تلقائياً.
// يتيح ذلك للمسؤول كتابة اسم القضاء أو الناحية بحرية دون التقيّد بالقائمة المبذورة مسبقاً.
function resolveOrCreateDistrict(govId, rawName, actor) {
  const name = String(rawName).trim();
  if (!name) return null;
  const gov = get('SELECT * FROM governorates WHERE id = ?', [govId]);
  if (!gov) throw new ApiError(400, 'المحافظة غير موجودة');
  const existing = all('SELECT * FROM districts WHERE governorate_id = ?', [govId])
    .find((d) => d.name_ar && d.name_ar.trim().toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const code = genDistrictCode(govId, name);
  const id = run(
    'INSERT INTO districts (governorate_id, name_ar, name_en, code, lease_fee, is_active, sort_order) VALUES (?,?,?,?,?,1,0)',
    [govId, name, name, code, Number(gov.lease_fee) || 0]
  ).lastId;
  logActivity(actor, 'create', 'district', id, { name_ar: name, auto_created: true });
  return id;
}

function listAgents(query) {
  const { q, governorate_id, district_id } = query || {};
  const params = [];
  const conds = [];
  if (q) {
    const like = `%${q}%`;
    conds.push('(u.name_ar LIKE ? OR u.name_en LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR g.name_ar LIKE ? OR d.name_ar LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  if (governorate_id) {
    conds.push('a.governorate_id = ?');
    params.push(Number(governorate_id));
  }
  if (district_id) {
    conds.push('a.district_id = ?');
    params.push(Number(district_id));
  }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  const rows = all(
    AGENT_SELECT.replace(
      '\n  FROM agents a',
      `,
       SUM(CASE WHEN o.status != 'cancelled' THEN 1 ELSE 0 END) AS orders_count,
       COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount END),0) AS governorate_orders_value,
       COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.agent_amount END),0) AS earnings,
       (SELECT COUNT(*) FROM providers pr WHERE pr.governorate_id = a.governorate_id) AS providers_count
  FROM agents a`
    ).replace(
      'JOIN governorates g ON g.id = a.governorate_id\n',
      `JOIN governorates g ON g.id = a.governorate_id
  LEFT JOIN providers p ON p.governorate_id = a.governorate_id
  LEFT JOIN orders o ON o.provider_id = p.id\n`
    ) + where + ' GROUP BY a.id ORDER BY a.id DESC',
    params
  ).map((a) => ({
    ...a,
    orders_count: Number(a.orders_count) || 0,
    governorate_orders_value: round2(Number(a.governorate_orders_value) || 0),
    earnings: round2(Number(a.earnings) || 0),
    providers_count: Number(a.providers_count) || 0,
  }));

  const pg = paginate({ query }, 50);
  if (pg.enabled) {
    return {
      rows: rows.slice(pg.offset, pg.offset + pg.limit),
      meta: { total: rows.length, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(rows.length / pg.limit)) },
    };
  }
  return { rows, meta: null };
}

function getAgent(id) {
  const aid = toId(id);
  const agent = get(AGENT_SELECT + ' WHERE a.id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');
  return agent;
}

async function createAgent(actor, body) {
  const { name_ar, name_en, email, phone, password, governorate_id, district_id, district_name, commission_rate = settingValue('agent_default_commission', 2) } = body || {};
  const typedDistrict = district_name ? String(district_name).trim() : '';
  if (typedDistrict) assertLength(typedDistrict, 100, 'اسم القضاء');
  if (!name_ar || !email || (!district_id && !typedDistrict && !governorate_id)) throw new ApiError(400, 'يرجى ملء الحقول المطلوبة (الاسم، البريد، المحافظة أو القضاء)');
  if (name_ar !== undefined && name_ar !== '') assertLength(name_ar, 100, 'الاسم');
  if (name_en !== undefined && name_en !== '') assertLength(name_en, 100, 'الاسم اللاتيني');
  const rate = Number(commission_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
  }

  let govId;
  let distId = null;
  if (district_id) {
    const dist = get('SELECT * FROM districts WHERE id = ?', [Number(district_id)]);
    if (!dist) throw new ApiError(400, 'القضاء غير موجود');
    govId = dist.governorate_id;
    distId = dist.id;
    const dupDistrict = get('SELECT id FROM agents WHERE district_id = ?', [distId]);
    if (dupDistrict) throw new ApiError(409, 'يوجد وكيل مسجل لهذا القضاء بالفعل');
  } else if (typedDistrict) {
    distId = resolveOrCreateDistrict(Number(governorate_id), typedDistrict, actor);
    const dist = get('SELECT * FROM districts WHERE id = ?', [distId]);
    govId = dist.governorate_id;
    distId = dist.id;
    const dupDistrict = get('SELECT id FROM agents WHERE district_id = ?', [distId]);
    if (dupDistrict) throw new ApiError(409, 'يوجد وكيل مسجل لهذا القضاء بالفعل');
  } else {
    govId = Number(governorate_id);
    const gov = get('SELECT * FROM governorates WHERE id = ?', [govId]);
    if (!gov) throw new ApiError(400, 'المحافظة غير موجودة');
    const dupGov = get('SELECT id FROM agents WHERE governorate_id = ? AND district_id IS NULL', [govId]);
    if (dupGov) throw new ApiError(409, 'يوجد وكيل مسجل لهذه المحافظة بالفعل');
  }

  const existsUser = get('SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)', [email, phone || '']);
  if (existsUser) throw new ApiError(409, 'البريد أو رقم الهاتف مستخدم مسبقاً');

  const finalPassword = password || randomPassword();
  const passwordHash = await hashPassword(finalPassword);
  let userId, agentId;
  transaction(() => {
    userId = run(
      'INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,?,?,1)',
      ['agent', name_ar, name_en || null, String(email).toLowerCase(), phone || null, passwordHash, govId]
    ).lastId;

    agentId = run(
      'INSERT INTO agents (user_id, governorate_id, district_id, commission_rate, lease_status) VALUES (?,?,?,?,?)',
      [userId, govId, distId, rate, 'pending']
    ).lastId;
  });

  logActivity(actor, 'create', 'agent', agentId, { name_ar, district: !!distId });
  const createdAgent = get(AGENT_SELECT + ' WHERE a.id = ?', [agentId]);
  return { ...createdAgent, generated_password: password ? undefined : finalPassword };
}

function updateAgent(actor, id, body) {
  const aid = toId(id);
  const agent = get('SELECT * FROM agents WHERE id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');
  const user = get('SELECT * FROM users WHERE id = ?', [agent.user_id]);

  const { name_ar, name_en, email, phone, governorate_id, district_id, district_name, commission_rate, is_active } = body || {};
  const typedDistrict = district_name !== undefined ? String(district_name).trim() : null;

  if (name_en !== undefined && name_en !== '') assertLength(name_en, 100, 'الاسم اللاتيني');

  if (commission_rate !== undefined) {
    const rate = Number(commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
    }
  }

  const phoneNorm = phone === undefined ? user.phone : (String(phone).trim() ? String(phone).trim() : null);
  const emailNorm = email === undefined ? user.email : (String(email).trim() ? String(email).trim().toLowerCase() : null);

  // تحديد القضاء/المحافظة الجديدة (إذا وُرّدت)
  let newDistrictId = agent.district_id;
  let newGovId = agent.governorate_id;
  const districtIdProvided = district_id !== undefined && district_id !== null && district_id !== '';
  if (districtIdProvided) {
    const dist = get('SELECT * FROM districts WHERE id = ?', [Number(district_id)]);
    if (!dist) throw new ApiError(400, 'القضاء غير موجود');
    const dup = get('SELECT id FROM agents WHERE district_id = ? AND id != ?', [dist.id, aid]);
    if (dup) throw new ApiError(409, 'يوجد وكيل مسجل لهذا القضاء بالفعل');
    newDistrictId = dist.id;
    newGovId = dist.governorate_id;
  } else if (typedDistrict !== null) {
    // اسم القضاء/الناحية أُرسل صراحةً (حتى إن كان فارغاً) → هو المرجع المعتمد
    if (typedDistrict === '') {
      // مسح ارتباط القضاء → وكيل على مستوى المحافظة
      const targetGov = governorate_id !== undefined ? Number(governorate_id) : agent.governorate_id;
      const dup = get('SELECT id FROM agents WHERE governorate_id = ? AND district_id IS NULL AND id != ?', [targetGov, aid]);
      if (dup) throw new ApiError(409, 'يوجد وكيل مسجل لهذه المحافظة بالفعل');
      newDistrictId = null;
      newGovId = targetGov;
    } else {
      const govForDistrict = governorate_id !== undefined ? Number(governorate_id) : agent.governorate_id;
      const did = resolveOrCreateDistrict(govForDistrict, typedDistrict, actor);
      const dist = get('SELECT * FROM districts WHERE id = ?', [did]);
      const dup = get('SELECT id FROM agents WHERE district_id = ? AND id != ?', [did, aid]);
      if (dup) throw new ApiError(409, 'يوجد وكيل مسجل لهذا القضاء بالفعل');
      newDistrictId = did;
      newGovId = dist.governorate_id;
    }
  } else if (governorate_id && Number(governorate_id) !== agent.governorate_id) {
    const dup = get('SELECT id FROM agents WHERE governorate_id = ? AND district_id IS NULL AND id != ?', [Number(governorate_id), aid]);
    if (dup) throw new ApiError(409, 'يوجد وكيل مسجل لهذه المحافظة بالفعل');
    const gov = get('SELECT id FROM governorates WHERE id = ?', [Number(governorate_id)]);
    if (!gov) throw new ApiError(400, 'المحافظة غير موجودة');
    newGovId = Number(governorate_id);
  }

  if (emailNorm) {
    const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [emailNorm, user.id]);
    if (dup) throw new ApiError(409, 'البريد مستخدم مسبقاً');
  }
  if (phoneNorm) {
    const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phoneNorm, user.id]);
    if (dup) throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
  }

  transaction(() => {
    run(
      'UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, governorate_id = ?, is_active = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [
        name_ar !== undefined ? name_ar : user.name_ar,
        name_en !== undefined ? name_en : user.name_en,
        emailNorm,
        phoneNorm,
        newGovId,
        is_active !== undefined ? (Number(is_active) ? 1 : 0) : user.is_active,
        user.id,
      ]
    );
    run(
      'UPDATE agents SET commission_rate = ?, district_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [commission_rate !== undefined ? Number(commission_rate) || 0 : agent.commission_rate, newDistrictId, aid]
    );
  });

  logActivity(actor, 'update', 'agent', aid, { name_ar });
  return get(AGENT_SELECT + ' WHERE a.id = ?', [aid]);
}

function deleteAgent(actor, id) {
  const aid = toId(id);
  const agent = get(AGENT_SELECT + ' WHERE a.id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');
  run("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [agent.user_id]);
  run("UPDATE agents SET lease_status = 'expired', updated_at = datetime('now') WHERE id = ?", [aid]);
  logActivity(actor, 'delete', 'agent', aid, { name_ar: agent.name_ar, governorate: agent.governorate_name_ar, soft: true });
  return { message: 'تم إيقاف الوكيل وحفظ سجل دفعات إجارته (تعطيل ناعم)' };
}

function renewLease(actor, id, body) {
  const aid = toId(id);
  const agent = get('SELECT * FROM agents WHERE id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');
  const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
  const district = agent.district_id ? get('SELECT * FROM districts WHERE id = ?', [agent.district_id]) : null;

  const { approve = 0, amount } = body || {};
  const { start, end } = nextLeasePeriod(agent.lease_expires_at);
  const fee = amount !== undefined && Number(amount) > 0 ? Number(amount) : (district ? district.lease_fee : gov.lease_fee);

  let payId;
  transaction(() => {
    payId = run(
      'INSERT INTO lease_payments (agent_id, governorate_id, district_id, amount, period_start, period_end, status, notes) VALUES (?,?,?,?,?,?,?,?)',
      [aid, gov.id, agent.district_id || null, fee, start.toISOString(), end.toISOString(), approve ? 'paid' : 'pending', approve ? 'تجديد مباشر من المسؤول' : 'طلب تجديد من الوكيل']
    ).lastId;

    if (approve) {
      run('UPDATE agents SET lease_status = ?, lease_expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?', ['active', end.toISOString(), aid]);
      run('UPDATE lease_payments SET paid_at = datetime(\'now\') WHERE id = ?', [payId]);
    } else {
      run('UPDATE agents SET lease_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['pending', aid]);
    }
  });

  logActivity(actor, 'renew_lease', 'agent', aid, { approve: !!approve, amount: fee, period_start: start.toISOString(), period_end: end.toISOString() });
  return {
    lease_payment_id: payId,
    agent_id: aid,
    amount: fee,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    status: approve ? 'paid' : 'pending',
    message: approve ? 'تم تجديد إجارة الوكالة بنجاح' : 'تم إرسال طلب التجديد بانتظار الموافقة',
  };
}

function getLeasePayments(id) {
  const aid = toId(id);
  const agent = get('SELECT id FROM agents WHERE id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');
  return all(
    `SELECT lp.*, g.name_ar AS governorate_name_ar, d.name_ar AS district_name_ar
     FROM lease_payments lp
     JOIN governorates g ON g.id = lp.governorate_id
     LEFT JOIN districts d ON d.id = lp.district_id
     WHERE lp.agent_id = ? ORDER BY lp.id DESC`,
    [aid]
  );
}

module.exports = {
  AGENT_SELECT,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  renewLease,
  getLeasePayments,
};
