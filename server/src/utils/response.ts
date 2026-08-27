function ok(res, data = {}, meta = {}) {
  return res.json({ success: true, data, meta });
}

function created(res, data = {}) {
  return res.status(201).json({ success: true, data });
}

function fail(res, status, message, details) {
  return res.status(status).json({ success: false, message, details });
}

module.exports = { ok, created, fail };
