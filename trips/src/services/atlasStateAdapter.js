// trips/trips/src/services/atlasStateAdapter.js
// State/il düzeyi atlas okuyucu (TR gibi)

import ALL from '../data/atlas-state/all.json';

/* ----------------------------- helpers ----------------------------- */
// Basit, JSC-dostu normalize/karşılaştırma (Intl yok, String.normalize yok)
const asciiFold = (s) => String(s ?? '').replace(
  /[İIıŞşĞğÜüÖöÇç]/g,
  (ch) => ({'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c'}[ch] || ch)
);
const norm = (s) => asciiFold(s).toLowerCase().replace(/\s+/g, ' ').trim();
const safeCmp = (a, b) => {
  const A = norm(a), B = norm(b);
  if (A < B) return -1; if (A > B) return 1; return 0;
};

// Şekil normalizasyonu
const normalizeHub = (h, idx = 0) => {
  const name = String(h?.name ?? `#${idx}`).trim();
   const lat  = Number(h?.lat ?? h?.latitude);
   const lng  = Number(h?.lng ?? h?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { name, lat, lng }
    : null;
};
const normalizeHubsShape = (any) => {
  const arr = (x) => Array.isArray(x) ? x : [];
  return {
    plane: arr(any?.plane).map(normalizeHub).filter(Boolean),
    train: arr(any?.train).map(normalizeHub).filter(Boolean),
    bus:   arr(any?.bus).map(normalizeHub).filter(Boolean),
  };
};

function getAll() { return ALL || { countries: {} }; }

/* ----------------------------- exports ----------------------------- */

export function listCountriesAdminLevel() {
  const all = getAll();
  const out = [];
  for (const cc of Object.keys(all.countries || {})) {
    const c = all.countries[cc];
    if (c?.level === 'admin') out.push({ code: c.code, name: c.name, level: 'admin' });
  }
  out.sort((a, b) => safeCmp(a.name, b.name));
  return out;
}

export function getCountryDoc(cc) {
  const all = getAll();
  const key = String(cc ?? '').toUpperCase();
  return all.countries?.[key] || null;
}

export function listAdmins(cc) {
  const doc = getCountryDoc(cc);
  const admins = Array.isArray(doc?.admins) ? doc.admins : [];
  return admins
    .map(a => ({ code: a?.code, name: a?.name }))
    .filter(x => x.code || x.name)
    .sort((a, b) => safeCmp(a.name, b.name));
}

// Kod ya da ad ile admin bul (tam eşleşme, normalleştirilmiş)
export function findAdmin(cc, query) {
  const doc = getCountryDoc(cc);
  const admins = Array.isArray(doc?.admins) ? doc.admins : [];
  const q = norm(query);
  if (!q) return null;
  return admins.find(a => norm(a?.code) === q || norm(a?.name) === q) || null;
}

export function getHubsForAdmin(cc, adminCodeOrName) {
  const doc = getCountryDoc(cc);
  const admins = Array.isArray(doc?.admins) ? doc.admins : [];
  if (!admins.length) return { plane: [], train: [], bus: [] };

  const q = norm(adminCodeOrName);
  if (!q) return { plane: [], train: [], bus: [] };

  // Null-safe tam eşleşme (katlanmış)
  const a = admins.find(x => norm(x?.code) === q || norm(x?.name) === q);
  if (!a?.hubs) return { plane: [], train: [], bus: [] };

  // Şekli normalize et + dedupe + isim sırası
  const shaped = normalizeHubsShape(a.hubs);

  const dedupe = (arr = []) => {
    const seen = new Set();
    const res = [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      const key = `${norm(it.name)}|${Math.round((it.lat ?? 0) * 1e6)}|${Math.round((it.lng ?? 0) * 1e6)}`;
      if (!seen.has(key)) { seen.add(key); res.push(it); }
    }
    res.sort((u, v) => safeCmp(u.name, v.name));
    return res;
  };

  return {
    plane: dedupe(shaped.plane),
    train: dedupe(shaped.train),
    bus:   dedupe(shaped.bus),
  };
}
