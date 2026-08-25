const STORAGE_KEY = 'raf_locale';

function loadLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'ar') return v;
  } catch {
    /* تجاهل */
  }
  return 'ar';
}

let current = loadLocale();

function applyDocument(locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
}

applyDocument(current);

export function getLocale() {
  return current;
}

export function setLocale(locale) {
  current = locale === 'en' ? 'en' : 'ar';
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {
    /* تجاهل */
  }
  applyDocument(current);
  return current;
}
