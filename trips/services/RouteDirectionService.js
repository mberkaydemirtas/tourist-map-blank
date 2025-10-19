// trips/services/RouteDirectionService.js
// Google Directions: çok duraklı rota (25 limit). Chunk + stitch, cache, abort destekli.
// + getModeSummaries: arabayla / yürüyerek / toplu taşıma süreleri

const BASE = 'https://maps.googleapis.com/maps/api/directions/json';

const inFlight = new Map(); // key -> AbortController
const cache = new Map();    // key -> { ts, data }
const CACHE_TTL_MS = 30 * 60 * 1000; // 30dk

function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0, coords = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1); lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1); lng += dlng;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}
function fmtLL(o) {
  return o.place_id ? `place_id:${o.place_id}` : `${o.lat},${o.lng}`;
}
export function routeKey(waypoints, mode) {
  const core = (waypoints || [])
    .map(p => (p?.place_id ? `pid:${p.place_id}` : `${Number(p?.lat).toFixed(6)},${Number(p?.lng).toFixed(6)}`))
    .join('|');
  return `${mode}|${core}`;
}

// Google limit: origin+dest dahil 25
function chunkWaypoints(raw) {
  const MAX = 25;
  if (!Array.isArray(raw) || raw.length <= MAX) return [raw || []];
  const chunks = [];
  let i = 0;
  while (i < raw.length - 1) {
    const end = Math.min(i + MAX - 1, raw.length - 1);
    const slice = raw.slice(i, end + 1);
    if (i !== 0) slice.unshift(raw[i - 1]); // önceki dest, bu parçanın origin’i
    chunks.push(slice);
    i = end;
  }
  return chunks;
}

async function fetchChunk({ pts, mode, apiKey, signal }) {
  const origin = pts[0];
  const destination = pts[pts.length - 1];
  const via = pts.slice(1, -1);

  const params = new URLSearchParams();
  params.set('origin', fmtLL(origin));
  params.set('destination', fmtLL(destination));
  if (via.length) params.set('waypoints', via.map(fmtLL).join('|'));
  params.set('mode', mode); // driving|walking|bicycling|transit
  if (mode === 'driving' || mode === 'transit') {
    params.set('departure_time', 'now'); // trafik / transit hesap
    if (mode === 'driving') params.set('traffic_model', 'best_guess');
  }
  params.set('key', apiKey);

  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (json.status !== 'OK') {
    const err = new Error(json.error_message || json.status || 'Directions error');
    err.code = json.status;
    throw err;
  }

  const route = json.routes?.[0];
  const legs = (route?.legs || []).map((leg) => ({
    distanceText: leg.distance?.text,
    distanceVal: leg.distance?.value ?? 0,
    durationText: leg.duration_in_traffic?.text || leg.duration?.text,
    durationVal: (leg.duration_in_traffic?.value ?? leg.duration?.value) ?? 0,
  }));

  const overviewPolyline = route?.overview_polyline?.points
    ? decodePolyline(route.overview_polyline.points)
    : [];

  const distanceVal = legs.reduce((a, l) => a + (l.distanceVal || 0), 0);
  const durationVal = legs.reduce((a, l) => a + (l.durationVal || 0), 0);

  return {
    summary: {
      distanceVal,
      distanceText: `${(distanceVal / 1000).toFixed(1)} km`,
      durationVal,
      durationText: `${Math.round(durationVal / 60)} dk`,
    },
    legs,
    overviewPolyline,
    providerMeta: { provider: 'google', warnings: route?.warnings || [] },
  };
}

/** Çok duraklı ana rota (tek mod) — polyline + legs */
export async function getRouteDirections({ waypoints, mode = 'driving', apiKey }) {
  if (!apiKey) throw new Error('Directions API key gerekli');
  if (!Array.isArray(waypoints) || waypoints.length < 2) throw new Error('En az origin & destination gerekli');

  const key = routeKey(waypoints, mode);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  if (inFlight.has(key)) {
    try { inFlight.get(key).abort(); } catch {}
    inFlight.delete(key);
  }
  const controller = new AbortController();
  inFlight.set(key, controller);

  try {
    const chunks = chunkWaypoints(waypoints);
    const parts = [];
    for (const pts of chunks) {
      const part = await fetchChunk({ pts, mode, apiKey, signal: controller.signal });
      parts.push(part);
    }

    // stitch
    const polylineCoords = parts.flatMap(p => p.overviewPolyline);
    const legs = parts.flatMap(p => p.legs);
    const distanceVal = parts.reduce((a, p) => a + (p.summary.distanceVal || 0), 0);
    const durationVal = parts.reduce((a, p) => a + (p.summary.durationVal || 0), 0);

    const data = {
      polylineCoords,
      legs,
      summary: {
        distanceVal,
        distanceText: `${(distanceVal / 1000).toFixed(1)} km`,
        durationVal,
        durationText: `${Math.round(durationVal / 60)} dk`,
      },
      providerMeta: { provider: 'google', chunks: parts.length },
    };
    cache.set(key, { ts: Date.now(), data });
    return data;
  } finally {
    inFlight.delete(key);
  }
}

/** Arabayla / Yürüyerek / Toplu taşıma özetleri (dakika + km) */
export async function getModeSummaries({ waypoints, apiKey, modes = ['driving', 'walking', 'transit'] }) {
  const out = {};
  await Promise.all(
    modes.map(async (m) => {
      try {
        const d = await getRouteDirections({ waypoints, mode: m, apiKey });
        out[m] = {
          distanceVal: d.summary.distanceVal,
          distanceText: d.summary.distanceText,
          durationVal: d.summary.durationVal,
          durationText: d.summary.durationText,
        };
      } catch {
        out[m] = null; // bu mod desteklemiyorsa/başarısızsa boş bırak
      }
    })
  );
  return out;
}
