let _strings = {};

export function loadLocale(strings) { _strings = strings; }

export function t(key, vars) {
  const val = key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), _strings);
  if (val == null) return key;
  if (!vars) return val;
  return val.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? vars[k] : `{{${k}}}`));
}
