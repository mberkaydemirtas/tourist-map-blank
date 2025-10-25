// trips/services/planService.js
import { suggestMealsForGaps } from './mealSuggest';
import { API_BASE } from '../../app/lib/api';
import { Platform, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import { getAnchorsForDayDetailed } from '../shared/anchors';


/* ============================== Config ============================== */

// Metro dev server IP'sini scriptURL'den çek (örn. 192.168.1.34)
function getMetroHostFromScriptURL() {
  try {
    const url = NativeModules?.SourceCode?.scriptURL || '';
    const m = url.match(/\/\/([^:]+):\d+\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const METRO_HOST = getMetroHostFromScriptURL();
const IS_DEVICE = !!(Constants && Constants.isDevice);
// Emülatör için Android loopback
const EMU_LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

// Kullanıcı ENV öncelikli
const ENV_OPT = (process.env?.EXPO_PUBLIC_OPTIMIZER_BASE || '').trim() || null;

// Varsayılan (ENV yoksa) ilk denenecek base
const FIRST_GUESS = ENV_OPT
  ? ENV_OPT
  : (IS_DEVICE
      // Cihazdaysak önce reverse varmış gibi deneyelim
      ? 'http://127.0.0.1:8001'
      // Emülatördeysek 10.0.2.2
      : `http://${EMU_LOCALHOST}:8001`
    );

// Diğer adaylar (başarısız olursa sırayla denenecek)
const CANDIDATE_BASES = [
  FIRST_GUESS,
  // Emülatör loopback
  `http://${EMU_LOCALHOST}:8001`,
  // Cihaz loopback (reverse varsa çalışır)
  'http://127.0.0.1:8001',
  // Metro host IP (kablosuz ADB’de çoğunlukla bu işe yarar)
  ...(METRO_HOST ? [`http://${METRO_HOST}:8001`] : []),
];

// Çalışan base'i cache'le
let ACTIVE_OPTIMIZER_BASE = null;

async function tryFetch(url, opts = {}, timeoutMs = 6000) {
  let timeoutId;
  const timer = new Promise((_, rej) => {
    timeoutId = setTimeout(() => rej(new Error(`timeout_${timeoutMs}`)), timeoutMs);
  });
  try {
    const res = await Promise.race([fetch(url, opts), timer]);
    return res;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Base’i “ulaşılabilir” saymak için herhangi bir HTTP yanıtı (200/404/405 vs.) yeterli;
// ağ hatası, DNS, CORS/timeout gibi durumlarda başarısız kabul ediyoruz.
async function isReachableBase(base) {
  try {
    const res = await tryFetch(base, { method: 'GET' }, 3000);
    return !!res; // 404 bile gelse socket kurulduysa ulaşıldı demektir
  } catch {
    return false;
  }
}

// İlk başarılı base’i bul ve cache’e yaz
async function resolveOptimizerBase() {
  if (ACTIVE_OPTIMIZER_BASE) return ACTIVE_OPTIMIZER_BASE;
  for (const b of CANDIDATE_BASES) {
    try {
      const ok = await isReachableBase(b);
      if (ok) {
        ACTIVE_OPTIMIZER_BASE = b;
        console.log('[OPTIMIZER] ✅ base selected =', ACTIVE_OPTIMIZER_BASE);
        return ACTIVE_OPTIMIZER_BASE;
      }
    } catch {}
  }
  // Hiçbiri erişilemezse yine de ilk tahmini döndürelim (çağrı sırasında yakalanır)
  ACTIVE_OPTIMIZER_BASE = FIRST_GUESS;
  console.warn('[OPTIMIZER] ⚠️ no reachable base found, using FIRST_GUESS =', ACTIVE_OPTIMIZER_BASE);
  return ACTIVE_OPTIMIZER_BASE;
}

// Debug çıktısı
(async () => {
  console.log('[OPTIMIZER] ENV =', ENV_OPT || '(none)');
  console.log('[OPTIMIZER] METRO_HOST =', METRO_HOST || '(unknown)');
  console.log('[OPTIMIZER] candidates =', CANDIDATE_BASES);
})();

// Toggle real directions (Google proxy on your Node server)
const USE_REAL_DIRECTIONS_DEFAULT = true;

// Global request timeout (ms)
const REQ_TIMEOUT_MS = Math.max(
  8000,
  Number(process.env?.EXPO_PUBLIC_API_TIMEOUT_MS || 15000)
);

/* ============================== fetch helpers ============================== */
// RN/Android'de AbortController bazı ağ sürümlerinde "Network request failed" tetikleyebiliyor.
// Optimizer çağrıları için "signal" KULLANMADAN manuel timeout uygula.
async function fetchJsonNoSignal(url, opts = {}, timeoutMs = REQ_TIMEOUT_MS) {
  let timeoutId;
  try {
    const timer = new Promise((_, rej) => {
      timeoutId = setTimeout(() => rej(new Error(`timeout_${timeoutMs}`)), timeoutMs);
    });
    const res = await Promise.race([fetch(url, opts), timer]);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText} ${txt || ''}`.trim());
    }
    return await res.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Genel amaçlı (directions gibi diğer uçlar) — burada AbortController sorun yaratmıyordu:
async function fetchJson(url, opts = {}, timeoutMs = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText} ${txt || ''}`.trim());
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/* ============================== Helpers ============================== */

function enumerateDates(startDateISO, endDateISO) {
  if (!startDateISO || !endDateISO) return [];
  const out = [];
  const s = new Date(startDateISO);
  const e = new Date(endDateISO);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out.map(d => d.toISOString().slice(0, 10));
}
function toRad(x) { return (x * Math.PI) / 180; }
function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s1 = Math.sin(dLat / 2) ** 2 +
             Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}
function pickVisitDuration(place, prefs) {
  const cat = place?.category || 'sights';
  return prefs?.defaultDurations?.[cat] ?? 45;
}
function toMinutes(hhmm) {
  const [h, m] = (hhmm || '09:30').split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Decode Google encoded polyline → [{lat,lon}, ...]
function decodePolyline(enc = '') {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  while (index < enc.length) {
    let b, shift = 0, result = 0;
    do { b = enc.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0; result = 0;
    do { b = enc.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    coordinates.push({ lat: lat / 1e5, lon: lng / 1e5 });
  }
  return coordinates;
}

function ensureActivityIds(day) {
  if (!day?.activities) return day;
  day.activities = day.activities.map((a, i) => {
    if (a.id) return a;
    const base = a.place?.id || `${a.place?.location?.lat},${a.place?.location?.lon}` || 'x';
    return { ...a, id: `${a.type || 'act'}:${day.date || 'd'}:${base}:${i}` };
  });
  return day;
}

async function fetchLegPolyline(from, to, mode = 'driving') {
  try {
    const qs = `from=${from.lat},${from.lon}&to=${to.lat},${to.lon}&mode=${mode}`;
    const json = await fetchJson(`${API_BASE}/api/directions?${qs}`, {}, REQ_TIMEOUT_MS);

    if (json?.polyline && Array.isArray(json.polyline)) {
      return json.polyline.map(p => ({
        lat: p.lat ?? p.latitude,
        lon: p.lon ?? p.longitude,
      })).filter(p => p.lat != null && p.lon != null);
    }
    const pts = json?.routes?.[0]?.overview_polyline?.points;
    if (typeof pts === 'string' && pts.length > 0) {
      return decodePolyline(pts);
    }
  } catch (e) {
    console.warn('[planService] directions fetch failed → fallback', e?.message || e);
  }
  // Fallback: straight line
  return [from, to];
}

/* ---------- Bölgeleme yardımcıları (K-means + süre dengesi) ---------- */

function toMetersProj(lat, lon, lat0) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return { x: lon * mPerDegLon, y: lat * mPerDegLat };
}

function kmeans(points, k, maxIter = 30) {
  if (k <= 1 || points.length <= k) {
    return points.map((p, i) => ({ ...p, _k: Math.min(i, k - 1) }));
  }
  const centers = [];
  centers.push(points[Math.floor(Math.random() * points.length)]);
  while (centers.length < k) {
    let bestP = null, bestD = -1;
    for (const p of points) {
      const d = Math.min(...centers.map(c => (p.x - c.x) ** 2 + (p.y - c.y) ** 2));
      if (d > bestD) { bestD = d; bestP = p; }
    }
    centers.push(bestP);
  }
  for (let it = 0; it < maxIter; it++) {
    for (const p of points) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (p.x - centers[i].x) ** 2 + (p.y - centers[i].y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      p._k = best;
    }
    const sums = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
    for (const p of points) { const b = sums[p._k]; b.x += p.x; b.y += p.y; b.n++; }
    let moved = 0;
    for (let i = 0; i < k; i++) {
      if (sums[i].n === 0) continue;
      const nx = sums[i].x / sums[i].n, ny = sums[i].y / sums[i].n;
      if (Math.abs(nx - centers[i].x) + Math.abs(ny - centers[i].y) > 1e-6) moved++;
      centers[i] = { ...centers[i], x: nx, y: ny };
    }
    if (!moved) break;
  }
  return points;
}

function rebalanceByDuration(buckets, targetMin) {
  const over = () => buckets.some(b => b.sum > targetMin * 1.15);
  let guard = 24;
  while (over() && guard-- > 0) {
    let hi = 0, lo = 0;
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].sum > buckets[hi].sum) hi = i;
      if (buckets[i].sum < buckets[lo].sum) lo = i;
    }
    const move = buckets[hi].items.pop();
    if (!move) break;
    buckets[hi].sum -= move.dur;
    buckets[lo].items.push(move);
    buckets[lo].sum += move.dur;
  }
}

const minutesFor = (place, prefs) => pickVisitDuration(place, prefs);

function assignPlacesToDays(selectedPlaces, days, lodgingsByDate, prefs) {
  const centerKey = (loc) =>
    loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
      ? `${Number(loc.lat).toFixed(5)},${Number(loc.lon).toFixed(5)}`
      : 'none';

  const groups = new Map();
  for (const d of days) {
    const center = lodgingsByDate[d.date]?.location || null;
    const key = centerKey(center);
    if (!groups.has(key)) groups.set(key, { center, days: [] });
    groups.get(key).days.push(d);
  }

  const entries = Array.from(groups.entries());
  const attach = new Map(entries.map(([k]) => [k, []]));
  for (const p of selectedPlaces) {
    let bestKey = 'none', bestD = Infinity;
    for (const [k, g] of entries) {
      if (!g.center) { if (bestKey === 'none') bestD = 0; continue; }
      const d = haversine(g.center, p.location);
      if (d < bestD) { bestD = d; bestKey = k; }
    }
    attach.get(bestKey).push(p);
  }

  for (const [key, grp] of entries) {
    const groupDays = grp.days;
    if (!groupDays.length) continue;

    const POIS = attach.get(key) || [];
    if (!POIS.length) continue;

    const K = Math.max(1, groupDays.length);

    const lat0 = grp.center?.lat ?? POIS[0].location.lat;
    const pts = POIS.map(p => {
      const { x, y } = toMetersProj(p.location.lat, p.location.lon, lat0);
      return { x, y, ref: p, dur: minutesFor(p, prefs) };
    });

    kmeans(pts, K);

    const buckets = Array.from({ length: K }, () => ({ items: [], sum: 0 }));
    for (const t of pts) {
      const b = buckets[t._k];
      b.items.push({ place: t.ref, dur: t.dur });
      b.sum += t.dur;
    }

    const daySpan = toMinutes(prefs?.dayEnd || '20:00') - toMinutes(prefs?.dayStart || '09:30');
    const target = Math.max(60, daySpan * 0.8);
    rebalanceByDuration(buckets, target);

    for (let i = 0; i < groupDays.length; i++) {
      const b = buckets[i % buckets.length];
      for (const it of b.items) {
        groupDays[i].activities.push({
          id: it.place.id,
          type: 'visit',
          place: it.place,
          durationMin: it.dur,
          meta: { category: it.place.category },
        });
      }
    }
  }
}

/* ============================== Optimizer Glue ============================== */

function openingToWindow(place, dayStartMin, dayEndMin) {
  const oh = place?.opening_hours;
  if (!oh) return { open_min: dayStartMin, close_min: dayEndMin };
  const openStr = oh.open || null;
  const closeStr = oh.close || null;
  if (openStr && closeStr) {
    const o = toMinutes(openStr);
    const c = toMinutes(closeStr);
    return { open_min: Math.max(dayStartMin, o), close_min: Math.min(dayEndMin, c) };
  }
  return { open_min: dayStartMin, close_min: dayEndMin };
}

async function callOptimizer(payload) {
  // ACTIVE_OPTIMIZER_BASE yoksa çöz ve cache’le
  const firstBase = await resolveOptimizerBase();

  const bases = ACTIVE_OPTIMIZER_BASE
    ? [ACTIVE_OPTIMIZER_BASE, ...CANDIDATE_BASES.filter(b => b !== ACTIVE_OPTIMIZER_BASE)]
    : [firstBase, ...CANDIDATE_BASES.filter(b => b !== firstBase)];

  let lastErr;
  for (const base of bases) {
    const url = `${base}/optimize-day`;
    try {
      console.log('[OPT] POST', url);
      const json = await fetchJsonNoSignal(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }, REQ_TIMEOUT_MS);
      // Başarılı → bu base’i aktif tut
      ACTIVE_OPTIMIZER_BASE = base;
      return json;
    } catch (e) {
      lastErr = e;
      console.warn('[OPT] fail @', base, '→', e?.message || e);
    }
  }
  throw lastErr || new Error('optimizer_unreachable');
}

/** 🔸 Start/End günlerine özel saat override + hub/konaklama seçimleri */
function dayBoundsFor(day, prefs, startEndSingle) {
  const isStartDay = !!(startEndSingle?.start?.date && startEndSingle.start.date === day.date);
  const isEndDay   = !!(startEndSingle?.end?.date   && startEndSingle.end.date   === day.date);
  const startTimeOverride = isStartDay && startEndSingle?.start?.time ? startEndSingle.start.time : null;
  const endTimeOverride   = isEndDay   && startEndSingle?.end?.time   ? startEndSingle.end.time   : null;
  const dayStartMin = toMinutes(startTimeOverride || prefs.dayStart || '09:30');
  const dayEndMin   = toMinutes(endTimeOverride   || prefs.dayEnd   || '20:00');
  return { dayStartMin, dayEndMin };
}

function pickStartEndCoordsForDay(day, visits, lodgingsByDate, startEndSingle) {
  const lodge = lodgingsByDate[day.date];
  const isStartDay = !!(startEndSingle?.start?.date && startEndSingle.start.date === day.date);
  const isEndDay   = !!(startEndSingle?.end?.date   && startEndSingle.end.date   === day.date);

  const startHub = isStartDay && startEndSingle?.start?.hub?.location
    ? { lat: startEndSingle.start.hub.location.lat, lon: startEndSingle.start.hub.location.lng }
    : null;

  const endHub = isEndDay && startEndSingle?.end?.hub?.location
    ? { lat: startEndSingle.end.hub.location.lat, lon: startEndSingle.end.hub.location.lng }
    : null;

  const fallback = visits?.[0]?.place?.location || { lat: 39.9208, lon: 32.8541 }; // Ankara fallback
  const startCoord = startHub || lodge?.location || fallback;
  const endCoord   = endHub   || lodge?.location || fallback;

  return { startCoord, endCoord };
}


function buildOptimizerReqForDay(day, visits, prefs, lodgingsByDate, startEndSingle) {
  const { dayStartMin, dayEndMin } = dayBoundsFor(day, prefs, startEndSingle);
  const { startCoord, endCoord } = pickStartEndCoordsForDay(day, visits, lodgingsByDate, startEndSingle);
  const validCoord = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lon);

  const stops = [];

  if (validCoord(startCoord)) {
    stops.push({
      id: 'start-lodging',
      name: 'Başlangıç (Konaklama)',
      coords: { lat: startCoord.lat, lon: startCoord.lon },
      stay_mins: 0,
      open_min: dayStartMin,
      close_min: dayEndMin,
      fixed: true,
    });
  }

  for (const v of visits) {
    const stay_mins = v.durationMin ?? pickVisitDuration(v.place, prefs);
    const win = openingToWindow(v.place, dayStartMin, dayEndMin);
    stops.push({
      id: v.id || v.place?.id || `${v.place?.location?.lat},${v.place?.location?.lon}`,
      name: v.place?.name || 'Visit',
      coords: { lat: v.place.location.lat, lon: v.place.location.lon },
      stay_mins,
      open_min: win.open_min,
      close_min: win.close_min,
      fixed: false,
    });
  }

  if (validCoord(endCoord)) {
    stops.push({
      id: 'end-lodging',
      name: 'Bitiş (Konaklama)',
      coords: { lat: endCoord.lat, lon: endCoord.lon },
      stay_mins: 0,
      open_min: dayStartMin,
      close_min: dayEndMin,
      fixed: true,
    });
  }

  return {
    day_start_time_min: dayStartMin,
    day_end_time_min: dayEndMin,
    start: validCoord(startCoord) ? { lat: startCoord.lat, lon: startCoord.lon } : undefined,
    end:   validCoord(endCoord)   ? { lat: endCoord.lat,   lon: endCoord.lon   } : undefined,
    mode: (prefs.travelMode === 'driving' ? 'driving' : 'walking'),
    stops,
  };
}


function reorderActivitiesByOptimizer(day, visits, optimizerRes) {
  const idOrder = optimizerRes?.order || [];
  if (!idOrder.length) return visits;

  const byId = new Map(visits.map(v => {
    const id = v.id || v.place?.id || `${v.place?.location?.lat},${v.place?.location?.lon}`;
    return [id, v];
  }));

  const seq = [];
  idOrder.forEach(id => {
    const v = byId.get(id);
    if (v) seq.push(v);
  });

  if (seq.length < visits.length) {
    const missing = visits.filter(v => !seq.includes(v));
    seq.push(...missing);
  }
  return seq;
}

/* ============================== Public API ============================== */

// Plan objesinin tripId'yi içerdiğinden emin oluyoruz
// Plan objesinin tripId'yi içerdiğinden emin oluyoruz
export async function generatePlan(trip, prefs, opts = {}) {
  const { useRealDirections = USE_REAL_DIRECTIONS_DEFAULT } = opts;

  const startISO = trip?.dateRange?.start || trip?._startEndSingle?.start?.date;
  const endISO   = trip?.dateRange?.end   || trip?._startEndSingle?.end?.date;
  const daysISO = enumerateDates(startISO, endISO);

  const selectedPlaces = (trip?.selectedPlaces || trip?.places || []).map(p => ({
    id: p.id || p.placeId || `${p.lat},${p.lon}`,
    name: p.name,
    category: p.category,
    rating: p.rating || 0,
    address: p.address,
    opening_hours: p.opening_hours,
    location: {
      lat: p.lat ?? p.location?.lat ?? p?.coords?.lat,
      lon: p.lon ?? p.location?.lon ?? p?.coords?.lng ?? p?.coords?.lon
    },
  })).filter(p => p.location?.lat != null && p.location?.lon != null);

  const lodgingsByDate = (trip?.lodgings || []).reduce((acc, l) => {
    const d = l?.date || l?.checkIn;
    if (!d) return acc;
    const lat = l?.location?.lat ?? l?.coords?.lat ?? l?.lat;
    const lon = l?.location?.lon ?? l?.location?.lng ?? l?.coords?.lon ?? l?.coords?.lng ?? l?.lon;
    acc[d] = {
      id: l.id,
      name: l.name || 'Lodging',
      location: (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : undefined,
      address: l.address,
    };
    return acc;
  }, {});

  let days = daysISO.map((date) => ({
    date,
    startLodgingId: lodgingsByDate[date]?.id,
    endLodgingId: lodgingsByDate[date]?.id,
    activities: [],
    route: null,
  }));

  assignPlacesToDays(selectedPlaces, days, lodgingsByDate, prefs);

  for (let d of days) {
    if (!d.activities.length) continue;

    const visits = d.activities.filter(a => a.type === 'visit');

    let orderedVisits = visits;
    let optimizerUsed = false;

    try {
      const payload = buildOptimizerReqForDay(d, visits, prefs, lodgingsByDate, trip?._startEndSingle);
      const res = await callOptimizer(payload); // {order, total_minutes, ...}
      orderedVisits = reorderActivitiesByOptimizer(d, visits, res);
      optimizerUsed = true;
      console.log('[OPT] ✅ optimizer used for', d.date);
    } catch (e) {
      console.warn('[planService] optimizer unreachable, using NN fallback →', e?.message || e);
      // NN fallback
      const startCenter =
        (trip?._startEndSingle?.start?.date === d.date && trip?._startEndSingle?.start?.hub?.location)
          ? { lat: trip._startEndSingle.start.hub.location.lat, lon: trip._startEndSingle.start.hub.location.lng }
          : (lodgingsByDate[d.date]?.location || visits[0].place.location);

      const pool = [...visits];
      orderedVisits = [];
      let cur = startCenter;
      while (pool.length) {
        let bi = 0, bd = Infinity;
        pool.forEach((a, i) => {
          const dist = haversine(cur, a.place.location);
          if (dist < bd) { bd = dist; bi = i; }
        });
        const pick = pool.splice(bi, 1)[0];
        orderedVisits.push(pick);
        cur = pick.place.location;
      }
    }

    d.activities = orderedVisits.map(v => ({ ...v }));

    // Günün zaman penceresi: start/end hub saat override'larını uygula
    const { dayStartMin, dayEndMin } = dayBoundsFor(d, prefs, trip?._startEndSingle);
    let curMin = dayStartMin;
    for (const a of d.activities) {
      a.start = fromMinutes(curMin);
      const dur = a.durationMin || 45;
      curMin = Math.min(curMin + dur, dayEndMin);
      a.end = fromMinutes(curMin);
    }

    // Polyline: start/end hub veya lodging
    const { startCoord: start, endCoord: endNode } =
      pickStartEndCoordsForDay(d, d.activities, lodgingsByDate, trip?._startEndSingle);

    let poly = [];
    let prev = start || d.activities[0].place.location;

    for (const a of d.activities) {
      const leg = useRealDirections
        ? await fetchLegPolyline(prev, a.place.location, prefs.travelMode || 'driving')
        : [prev, a.place.location];

      if (poly.length && leg.length) {
        const last = poly[poly.length - 1];
        const head = leg[0];
        poly = poly.concat((last && head && last.lat === head.lat && last.lon === head.lon) ? leg.slice(1) : leg);
      } else {
        poly = poly.concat(leg);
      }
      prev = a.place.location;
    }

    if (endNode) {
      const leg = useRealDirections
        ? await fetchLegPolyline(prev, endNode, prefs.travelMode || 'driving')
        : [prev, endNode];
      if (poly.length && leg.length) {
        const last = poly[poly.length - 1];
        const head = leg[0];
        poly = poly.concat((last && head && last.lat === head.lat && last.lon === head.lon) ? leg.slice(1) : leg);
      } else {
        poly = poly.concat(leg);
      }
    }

    d.route = { polyline: poly, optimizerUsed };
    ensureActivityIds(d);
  }

  const cityName = (trip?.cities && trip.cities[0]?.name) || trip?.city || '';
  for (let i = 0; i < days.length; i++) {
    const anchor = getAnchorsForDayDetailed(trip, days[i]);
    days[i].anchor = {
      start: anchor.start,
      end: anchor.end,
      lodge: anchor.lodge,
      startLabel: anchor.startLabel,
      endLabel: anchor.endLabel,
    };
  }

  const tripKey = trip?._id || trip?.id || String(Date.now());
  trip.id = tripKey;
  if (!trip?.id) {
    trip.id = String(Date.now()); // Eğer trip.id eksikse, tarih bazlı bir ID oluştur
  }

  return {
    id: `plan:${trip.id}`,
    tripId: trip.id,  // Burada trip.id'yi kullanıyoruz
    days,
    version: 2,
    updatedAt: Date.now(),
  };
}

 

export async function reoptimizeDay(day, { mode = 'light' } = {}) {
  const next = { ...day, activities: day.activities.map(a => ({ ...a })) };
  let curMin = toMinutes('09:30');
  for (const a of next.activities) {
    a.start = fromMinutes(curMin);
    const dur = a.durationMin || 45;
    curMin += dur;
    a.end = fromMinutes(curMin);
  }
  return next;
}
