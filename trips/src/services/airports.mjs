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
  maxPages = Infinity,      // 👈 bütçe koruması
} = {}){
  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) throw new Error('AVIATIONSTACK_KEY yok (.env)');

  let offset = 0, total = Infinity, pages = 0;
  const out = [];

  while (offset < total && pages < maxPages){
    const page = await getPaged('/airports', { access_key: key, limit: limitPerPage, offset });
    const items = Array.isArray(page?.data) ? page.data : [];
    total  = Number(page?.pagination?.total ?? items.length);
    // ... normalize + push (aynı)
    offset += limitPerPage;
    pages += 1;
    if (sleepMs) await sleep(sleepMs);
  }
  // ... dedupe + sort (aynı)
  return merged;
}

