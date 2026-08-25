function parseLocale(req) {
  const q = (req && req.query && req.query.locale) || '';
  if (q === 'en') return 'en';
  const accept = req && req.headers && req.headers['accept-language'];
  if (accept && /\ben\b/i.test(String(accept))) return 'en';
  return 'ar';
}

function localized(ar, en, locale) {
  if (locale === 'en' && en) return en;
  return ar;
}

module.exports = { parseLocale, localized };
