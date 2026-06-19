'use strict';

const sxwnl = require('./SxwnlLoader');

function searchChineseCities(query) {
  const { JWv, JWdecode } = sxwnl;
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 1) return [];

  const results = [];
  for (const entry of JWv) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const province = entry[0];
    for (let i = 1; i < entry.length; i++) {
      const raw = entry[i];
      if (typeof raw !== 'string' || raw.length < 5) continue;
      const code = raw.substring(0, 4);
      const name = raw.substring(4);
      if (!name.toLowerCase().includes(q) && !province.toLowerCase().includes(q)) continue;
      try {
        const jw = new JWdecode(code);
        results.push({
          nameZh: name,
          province,
          latitude: +(jw.W * 180 / Math.PI).toFixed(4),
          longitude: +(jw.J * 180 / Math.PI).toFixed(4),
        });
      } catch (_) {}
      if (results.length >= 30) return results;
    }
  }
  return results;
}

module.exports = { searchChineseCities };
