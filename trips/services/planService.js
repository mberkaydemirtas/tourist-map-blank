// trips/services/planService.js
import { suggestMealsForGaps } from './mealSuggest';
import { API_BASE } from '../../app/lib/api';

/* ============================== Config ============================== */

// Optimizer base (FastAPI) — env → platform default
import { Platform } from 'react-native';
const LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
export const OPTIMIZER_BASE =
  (process.env?.EXPO_PUBLIC_OPTIMIZER_BASE || '').trim() ||
  `http://${LOCALHOST}:8001`;

// Toggle real directions (Google proxy on your Node server)
const USE_REAL_DIRECTIONS_DEFAULT = true;

/* ============================== Helpers ============================== */

function enumerateDates(startDateISO, endDateISO) {
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
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
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
    const res = await fetch(`${API_BASE}/api/directions?${qs}`);
    const json = await res.json();

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

/* ============================== Optimizer Glue ============================== */

function openingToWindow(place, dayStartMin, dayEndMin) {
  // Very light touch: if place.opening_hours has daily open/close, map it; else default to whole day
  // You can extend this to parse periods by weekday.
  const oh = place?.opening_hours;
  if (!oh) return { open_min: dayStartMin, close_min: dayEndMin };

  // Accept common shapes:
  // - {open_now:bool, weekday_text:[...]} → ignore detailed parse, keep day window
  // - {open:"10:00", close:"18:00"} custom (if you ever store this)
  const openStr = oh.open || null;
  const closeStr = oh.close || null;
  if (openStr && closeStr) {
    const o = toMinutes(openStr);
    const c = toMinutes(closeStr);
    // Clamp to day
    return { open_min: Math.max(dayStartMin, o), close_min: Math.min(dayEndMin, c) };
  }
  return { open_min: dayStartMin, close_min: dayEndMin };
}

async function callOptimizer(payload) {
  const url = `${OPTIMIZER_BASE}/optimize-day`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Optimizer ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

function buildOptimizerReqForDay(day, visits, prefs, lodgingsByDate) {
  const dayStartMin = toMinutes(prefs.dayStart || '09:30');
  const dayEndMin   = toMinutes(prefs.dayEnd   || '20:00');

  // Start/End: prefer lodging if present; otherwise first/last visit’s coords
  const lodge = lodgingsByDate[day.date];
  const startCoord =
    lodge?.location ||
    visits[0]?.place?.location ||
    { lat: visits[0]?.place?.location?.lat, lon: visits[0]?.place?.location?.lon };

  const endCoord =
    lodge?.location ||
    visits[visits.length - 1]?.place?.location ||
    startCoord;

  // Build stops
  const stops = visits.map(v => {
    const stay_mins = v.durationMin ?? pickVisitDuration(v.place, prefs);
    const win = openingToWindow(v.place, dayStartMin, dayEndMin);
    return {
      id: v.id || v.place?.id || `${v.place?.location?.lat},${v.place?.location?.lon}`,
      name: v.place?.name || 'Visit',
      coords: { lat: v.place.location.lat, lon: v.place.location.lon },
      stay_mins,
      open_min: win.open_min,
      close_min: win.close_min,
    };
  });

  return {
    day_start_time_min: dayStartMin,
    day_end_time_min: dayEndMin,
    start: { lat: startCoord.lat, lon: startCoord.lon },
    end:   { lat: endCoord.lat,   lon: endCoord.lon   },
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

  // Append any leftovers (shouldn’t happen, but safe)
  if (seq.length < visits.length) {
    const missing = visits.filter(v => !seq.includes(v));
    seq.push(...missing);
  }
  return seq;
}

/* ============================== Public API ============================== */

export async function generatePlan(trip, prefs, opts = {}) {
  const { useRealDirections = USE_REAL_DIRECTIONS_DEFAULT } = opts;

  // 1) Days
  const startISO = trip?.dateRange?.start || trip?._startEndSingle?.start?.date;
  const endISO   = trip?.dateRange?.end   || trip?._startEndSingle?.end?.date;
  const daysISO = enumerateDates(startISO, endISO);

  const selectedPlaces = (trip?.selectedPlaces || trip?.places || []).map(p => ({
    id: p.id || p.placeId || `${p.lat},${p.lon}`,
    name: p.name,
    category: p.category,
    rating: p.rating || 0,
    address: p.address,
    opening_hours: p.opening_hours, // carry forward if present
    location: { lat: p.lat ?? p.location?.lat ?? p?.coords?.lat, lon: p.lon ?? p.location?.lon ?? p?.coords?.lng ?? p?.coords?.lon },
  })).filter(p => p.location?.lat != null && p.location?.lon != null);

  // 2) Lodging index (same-day start/end)
  const lodgingsByDate = (trip?.lodgings || []).reduce((acc, l) => {
    const d = l?.date || l?.checkIn;
    if (!d) return acc;
    acc[d] = {
      id: l.id,
      name: l.name || 'Lodging',
      location: l.location || l.coords || { lat: l.lat, lon: l.lon },
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

  // 3) Rough assignment to days (closest to lodging center if any)
  for (const place of selectedPlaces) {
    let bestIdx = 0, bestScore = Infinity;
    days.forEach((d, i) => {
      const lodge = lodgingsByDate[d.date];
      const center = lodge?.location || place.location;
      const score = haversine(center, place.location);
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    });
    days[bestIdx].activities.push({
      id: place.id,
      type: 'visit',
      place,
      durationMin: pickVisitDuration(place, prefs),
      meta: { category: place.category },
    });
  }

  // 4) Optimize each day (order + timeline + route)
  for (let d of days) {
    if (!d.activities.length) continue;

    // Only visits go to the optimizer (meals will be inserted later)
    const visits = d.activities.filter(a => a.type === 'visit');

    // Build optimizer request and try to call it, fallback to NN if it fails
    let orderedVisits = visits;
    let optimizerUsed = false;

    try {
      const payload = buildOptimizerReqForDay(d, visits, prefs, lodgingsByDate);
      const res = await callOptimizer(payload); // {order, total_minutes, legs_minutes, ...}
      orderedVisits = reorderActivitiesByOptimizer(d, visits, res);
      optimizerUsed = true;
    } catch (e) {
      console.warn('[planService] optimizer unreachable, using NN fallback →', e?.message || e);
      // nearest-neighbor fallback
      const startCenter = lodgingsByDate[d.date]?.location || visits[0].place.location;
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

    // Rebuild day's activities with the optimized order (visits only for now)
    d.activities = orderedVisits.map(v => ({ ...v }));

    // Simple sequential timeline (you can refine with optimizer’s service/leg mins if you want)
    let curMin = toMinutes(prefs.dayStart || '09:30');
    for (const a of d.activities) {
      a.start = fromMinutes(curMin);
      const dur = a.durationMin || 45;
      curMin += dur;
      a.end = fromMinutes(curMin);
    }

    // Build route polyline (origin -> v1 -> v2 -> ... -> [end lodging])
    const legs = [];
    const start = lodgingsByDate[d.date]?.location || d.activities[0].place.location;
    let poly = [];
    let prev = start;

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
      legs.push({ from: prev, to: a.place.location, points: leg });
      prev = a.place.location;
    }

    const endLodge = lodgingsByDate[d.date]?.location;
    if (endLodge) {
      const leg = useRealDirections
        ? await fetchLegPolyline(prev, endLodge, prefs.travelMode || 'driving')
        : [prev, endLodge];
      if (poly.length && leg.length) {
        const last = poly[poly.length - 1];
        const head = leg[0];
        poly = poly.concat((last && head && last.lat === head.lat && last.lon === head.lon) ? leg.slice(1) : leg);
      } else {
        poly = poly.concat(leg);
      }
      legs.push({ from: prev, to: endLodge, points: leg });
    }

    d.route = { polyline: poly, optimizerUsed };
    ensureActivityIds(d);
  }

  // 5) Meal suggestions AFTER visit order is fixed
  const cityName = (trip?.cities && trip.cities[0]?.name) || trip?.city || '';
  for (let i = 0; i < days.length; i++) {
    days[i] = await suggestMealsForGaps(days[i], {
      prefs,
      selectedPlaces,
      city: cityName,
    });
    ensureActivityIds(days[i]);
  }

  return {
    id: `plan:${trip.id}`,
    tripId: trip.id,
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
  // route recompute could be added similarly using fetchLegPolyline
  return next;
}
