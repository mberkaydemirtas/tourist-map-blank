// trips/services/planService.js
import { suggestMealsForGaps } from './mealSuggest';
import { API_BASE } from '../../app/lib/api';

// ---- Helpers
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
  const def = prefs?.defaultDurations?.[cat] ?? 45;
  return def;
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

    // Esnek parse:
    // 1) json.polyline: [{lat,lon},...] veya {latitude,longitude}[]
    if (json?.polyline && Array.isArray(json.polyline)) {
      return json.polyline.map(p => ({
        lat: p.lat ?? p.latitude,
        lon: p.lon ?? p.longitude,
      })).filter(p => p.lat != null && p.lon != null);
    }
    // 2) Google format
    const pts = json?.routes?.[0]?.overview_polyline?.points;
    if (typeof pts === 'string' && pts.length > 0) {
      return decodePolyline(pts);
    }
  } catch (e) {
    console.warn('[planService] directions fetch failed → fallback', e?.message || e);
  }
  // Fallback: düz hat
  return [from, to];
}

// ---- Public API
export async function generatePlan(trip, prefs, opts = {}) {
  const { useRealDirections = true } = opts;

  // 1) Gün listesi
  const startISO = trip?.dateRange?.start || trip?._startEndSingle?.start?.date;
  const endISO   = trip?.dateRange?.end   || trip?._startEndSingle?.end?.date;
  const daysISO = enumerateDates(startISO, endISO);

  const selectedPlaces = (trip?.selectedPlaces || trip?.places || []).map(p => ({
    id: p.id || p.placeId || `${p.lat},${p.lon}`,
    name: p.name,
    category: p.category,
    rating: p.rating || 0,
    address: p.address,
    location: { lat: p.lat ?? p.location?.lat, lon: p.lon ?? p.location?.lon },
  })).filter(p => p.location?.lat != null && p.location?.lon != null);

  // 2) Lodging index
  const lodgingsByDate = (trip?.lodgings || []).reduce((acc, l) => {
    if (l?.date || l?.checkIn) {
      const d = l.date || l.checkIn; // tek günlük atama için
      acc[d] = {
        id: l.id,
        name: l.name || 'Lodging',
        location: l.location || l.coords || { lat: l.lat, lon: l.lon },
        address: l.address,
      };
    }
    return acc;
  }, {});

  const days = daysISO.map((date) => ({
    date,
    startLodgingId: lodgingsByDate[date]?.id,
    endLodgingId: lodgingsByDate[date]?.id,
    activities: [],
    route: null,
  }));

  // 3) Günlere kaba dağıtım (konaklama yakınlığı)
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

  // 4) Gün içi sıralama + timeline + rota
  for (const d of days) {
    if (!d.activities.length) continue;

    const start = lodgingsByDate[d.date]?.location || d.activities[0].place.location;
    const seq = [];
    const pool = [...d.activities];
    let cur = start;

    // nearest neighbor
    while (pool.length) {
      let bi = 0, bd = Infinity;
      pool.forEach((a, i) => {
        const dist = haversine(cur, a.place.location);
        if (dist < bd) { bd = dist; bi = i; }
      });
      const pick = pool.splice(bi, 1)[0];
      seq.push(pick);
      cur = pick.place.location;
    }
    d.activities = seq.map(a => ({ ...a }));

    // timeline (kabaca ardışık)
    let curMin = toMinutes(prefs.dayStart || '09:30');
    for (const a of d.activities) {
      a.start = fromMinutes(curMin);
      const dur = a.durationMin || 45;
      curMin += dur;
      a.end = fromMinutes(curMin);
    }

    // Gerçek rota (origin → a1 → a2 → ... → [end lodging])
    let poly = [];
    let prev = start;
    for (const a of d.activities) {
      const leg = useRealDirections ? await fetchLegPolyline(prev, a.place.location, prefs.travelMode || 'driving')
                                    : [prev, a.place.location];
      if (poly.length && leg.length) {
        // önceki son noktayla aynıysa tekrarı at
        const last = poly[poly.length - 1];
        const head = leg[0];
        if (last && head && last.lat === head.lat && last.lon === head.lon) {
          poly = poly.concat(leg.slice(1));
        } else {
          poly = poly.concat(leg);
        }
      } else {
        poly = poly.concat(leg);
      }
      prev = a.place.location;
    }
    const endLodge = lodgingsByDate[d.date]?.location;
    if (endLodge) {
      const leg = useRealDirections ? await fetchLegPolyline(prev, endLodge, prefs.travelMode || 'driving')
                                    : [prev, endLodge];
      if (poly.length && leg.length) {
        const last = poly[poly.length - 1];
        const head = leg[0];
        poly = poly.concat((last && head && last.lat === head.lat && last.lon === head.lon) ? leg.slice(1) : leg);
      } else {
        poly = poly.concat(leg);
      }
    }
    d.route = { polyline: poly };
    ensureActivityIds(d);
  }

  // 5) Yemek önerileri (kullanıcının seçtikleri yoksa yakındaki yüksek puanlı 'suggestion')
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
    version: 1,
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
  // (rota yeniden hesaplama ileride eklenebilir)
  return next;
}
