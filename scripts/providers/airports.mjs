// scripts/providers/airports.mjs
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'https://api.aviationstack.com/v1';

/**
 * Aviationstack paginated GET
 * @param {string} path - e.g. "/airports"
 * @param {object} params - { access_key, limit, offset, ... }
 * @returns {Promise<{pagination:{limit:number,offset:number,count:number,total:number}, data:any[]}>}
 */
async function getPaged(path, params){
  const qs = new URLSearchParams(params);
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { redirect: 'follow' });
  const json = await res.json();
  if (!res.ok || json?.error) {
    const msg = json?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(`Aviationstack error: ${msg}`);
  }
  return json;
}

/**
 * Tüm dünyadaki havalimanlarını sayfalı çeker (limit=100), istersek ülkeye göre filtreler.
 * Aviationstack Airports: /v1/airports  (limit/offset + pagination.total)
 * Response alanları: airport_name, iata_code, icao_code, latitude, longitude, country_iso2, city_iata_code, timezone, gmt, phone_number...
 */
// scripts/providers/airports.mjs (özet patch)
export async function fetchAirportsAviationstack({
  countryIso2,
  limitPerPage = 100,
  sleepMs = 120,
  maxPages = Infinity,         // bütçe koruması
} = {}) {
  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) throw new Error('AVIATIONSTACK_KEY yok (.env)');

  const wantCC = countryIso2 ? String(countryIso2).toUpperCase() : null;

  let offset = 0;
  let total  = Infinity;
  let pages  = 0;

  const collected = [];

  while (offset < total && pages < maxPages) {
    const params = { access_key: key, limit: limitPerPage, offset };
    if (wantCC) params.country_iso2 = wantCC;

    const page = await getPaged('/airports', params);
    const items = Array.isArray(page?.data) ? page.data : [];

    // pagination.total bazı planlarda eksik olabilir; fallback kullan.
    const pgTotal = Number(page?.pagination?.total);
    if (Number.isFinite(pgTotal)) total = pgTotal;
    else if (!Number.isFinite(total)) total = items.length; // tek sayfa gibi davran

    for (const it of items) {
      const name = it.airport_name || it.iata_code || it.icao_code || null;
      const lat  = Number(it.latitude);
      const lng  = Number(it.longitude);
      const cc   = (it.country_iso2 || '').toUpperCase();

      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (wantCC && cc && cc !== wantCC) continue;

      collected.push({ name, lat, lng });
    }

    offset += limitPerPage;
    pages  += 1;
    if (sleepMs) await sleep(sleepMs);
  }

  // Dedupe (~1e-6 derece ve isimle)
  const seen = new Set();
  const merged = [];
  for (const a of collected) {
    const k = `${a.name}|${Math.round(a.lat * 1e6)}|${Math.round(a.lng * 1e6)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(a);
  }

  // İsim sıralı
  merged.sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'tr', { sensitivity: 'base' })
  );

  return merged;
}