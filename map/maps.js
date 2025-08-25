// src/services/maps.js
import { GOOGLE_MAPS_API_KEY as KEY, MAPBOX_ACCESS_TOKEN } from '@env';
import axios from 'axios';
import polyline from '@mapbox/polyline';

const BASE = 'https://maps.googleapis.com/maps/api';

/* --------------------------------- Helpers -------------------------------- */

function formatPlaceType(types = []) {
  const PRIORITY = ['cafe', 'restaurant', 'bar', 'hotel', 'museum', 'library', 'bakery', 'pharmacy', 'atm', 'supermarket'];
  const match = PRIORITY.find(t => types?.includes(t));
  return match || (types?.[0] ?? 'place');
}

// Tek tip koordinat seçici: lat/lng veya latitude/longitude kabul et
function pickLL(p) {
  if (!p) return null;
  const lat = (p.lat ?? p.latitude);
  const lng = (p.lng ?? p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng, lat, lng };
}

// [deg]
function bearingDeg(a, b) {
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const λ1 = (a.lng * Math.PI) / 180, λ2 = (b.lng * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function decodePolyline(encoded) {
  try {
    if (!encoded) return [];
    const pts = polyline.decode(encoded); // [[lat,lng], ...]
    return pts.map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
      lat,
      lng,
    }));
  } catch (e) {
    console.warn('❌ decodePolyline failed:', e?.message || e);
    return [];
  }
}

// Haversine (metre)
const distM = (a, b) => {
  const aLat = Number(a?.lat);
  const aLng = Number(a?.lng);
  const bLat = Number(b?.lat);
  const bLng = Number(b?.lng);
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return 0;

  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

/* ----------------------- Autocomplete (route-biased) ---------------------- */
// basit session token
let _acSessionToken = null;
const getAutocompleteSessionToken = () => {
  if (!_acSessionToken) _acSessionToken = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return _acSessionToken;
};
export const resetAutocompleteSession = () => { _acSessionToken = null; };

/**
 * Rota-bias'lı autocomplete (genel amaçlı)
 * @param {string} input
 * @param {object} opts
 *  - bounds: { sw:{lat,lng}, ne:{lat,lng} } // rota dikdörtgeni (tercih)
 *  - lat,lng, radius                        // tek nokta bias
 *  - types                                  // örn. 'establishment'
 *  - country, language                      // default 'tr'
 *  - sessiontoken, strict                   // strictbounds denetimi
 */
export async function autocomplete(input, opts = {}) {
  const {
    bounds,
    lat,
    lng,
    radius,
    types,
    country = 'tr',
    language = 'tr',
    sessiontoken,
    strict = false,
  } = opts;

  const q = String(input || '').trim();
  if (!q) return [];

  const pick = (p) => p ? ({ lat: (p.lat ?? p.latitude), lng: (p.lng ?? p.longitude) }) : null;

  // bounds -> center+radius
  let loc = null;
  let rad = null;
  if (bounds?.sw && bounds?.ne) {
    const sw = pick(bounds.sw);
    const ne = pick(bounds.ne);
    if (sw && ne && [sw.lat, sw.lng, ne.lat, ne.lng].every(Number.isFinite)) {
      const center = { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 };
      loc = center;
      rad = radius ?? Math.min(50000, Math.max(500, Math.round(distM(center, ne) * 1.05)));
    }
  } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
    loc = { lat, lng };
    rad = radius ?? 2000;
  }

  const params = new URLSearchParams({
    input: q,
    key: KEY,
    language,
  });
  if (types) params.append('types', types);
  if (country) params.append('components', `country:${country}`);
  if (loc) {
    params.append('location', `${loc.lat},${loc.lng}`);
    if (rad) params.append('radius', String(Math.round(rad)));
    if (strict) params.append('strictbounds', 'true');
  }
  const token = sessiontoken || getAutocompleteSessionToken();
  if (token) params.append('sessiontoken', token);

  const url = `${BASE}/place/autocomplete/json?${params.toString()}`;
  try {
    const res = await fetch(url);
    const json = await res.json();

    if (json.status === 'ZERO_RESULTS' && strict && loc) {
      // strictbounds olmadan bir kez daha dene
      params.delete('strictbounds');
      const res2 = await fetch(`${BASE}/place/autocomplete/json?${params.toString()}`);
      const json2 = await res2.json();
      return Array.isArray(json2.predictions) ? json2.predictions : [];
    }

    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      console.warn('❌ autocomplete:', json.status, json?.error_message);
      return [];
    }
    return Array.isArray(json.predictions) ? json.predictions : [];
  } catch (err) {
    console.error('🌐 autocomplete fetch hatası:', err?.message || err);
    return [];
  }
}

/**
 * ŞEHİR autocomplete (ülkeye kısıtlı, dünya geneli)
 * @param {{input:string, country?:string, language?:string, sessiontoken?:string}} args
 */
export async function autocompleteCities({ input, country, language = 'tr', sessiontoken } = {}) {
  const q = String(input || '').trim();
  if (!q) return [];
  const params = new URLSearchParams({
    input: q,
    key: KEY,
    language,
    types: '(cities)',            // şehir hedefi
  });
  if (country) params.append('components', `country:${country}`);
  const token = sessiontoken || getAutocompleteSessionToken();
  if (token) params.append('sessiontoken', token);

  try {
    const res = await fetch(`${BASE}/place/autocomplete/json?${params.toString()}`);
    const json = await res.json();
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      console.warn('❌ autocompleteCities:', json.status, json?.error_message);
      return [];
    }
    return (json.predictions || []).map(p => ({
      description: p.description,
      place_id: p.place_id,
      main_text: p.structured_formatting?.main_text,
      secondary_text: p.structured_formatting?.secondary_text,
    }));
  } catch (e) {
    console.error('🌐 autocompleteCities error:', e?.message || e);
    return [];
  }
}

/* ------------------------------ Place Details ----------------------------- */
export async function getPlaceDetails(placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: [
      'name','formatted_address','geometry','photos','website','formatted_phone_number',
      'rating','price_level','opening_hours','reviews','types','url'
    ].join(','),
    key: KEY,
    language: 'tr',
  });

  try {
    const res = await fetch(`${BASE}/place/details/json?${params}`);
    const json = await res.json();

    if (json.status !== 'OK') {
      console.error('🟥 getPlaceDetails hata:', json.status, json?.error_message);
      return null;
    }

    const r = json.result || {};
    const { lat, lng } = r.geometry?.location || {};
    const photos = (r.photos || []).map(p =>
      `${BASE}/place/photo?maxwidth=800&photoreference=${p.photo_reference}&key=${KEY}`
    );

    return {
      name: r.name,
      address: r.formatted_address,
      formatted_address: r.formatted_address,
      website: r.website || null,
      phone: r.formatted_phone_number || null,
      rating: r.rating ?? null,
      priceLevel: r.price_level ?? null,
      openNow: r.opening_hours?.open_now ?? null,
      hoursToday: r.opening_hours?.weekday_text ?? [],
      opening_hours: r.opening_hours || null,
      photos,
      reviews: r.reviews || [],
      types: r.types || [],
      typeName: formatPlaceType(r.types),
      coords: (lat != null && lng != null) ? { latitude: lat, longitude: lng } : null,
      geometry: r.geometry,
      url: r.url || null,
      place_id: r.place_id,
    };
  } catch (err) {
    console.error('🟥 getPlaceDetails fetch hatası:', err?.message || err);
    return null;
  }
}

/**
 * Sade şehir/yer koordinatı: ad + address + geometry/location
 */
export async function getPlaceLatLng(place_id, language = 'tr') {
  const params = new URLSearchParams({
    place_id,
    key: KEY,
    language,
    fields: 'name,formatted_address,geometry/location',
  });
  try {
    const res = await fetch(`${BASE}/place/details/json?${params.toString()}`);
    const json = await res.json();
    if (json.status !== 'OK') {
      console.warn('❌ getPlaceLatLng:', json.status, json?.error_message);
      return null;
    }
    const r = json.result;
    return r ? {
      name: r.name,
      address: r.formatted_address,
      location: r.geometry?.location, // {lat,lng}
    } : null;
  } catch (e) {
    console.error('🌐 getPlaceLatLng error:', e?.message || e);
    return null;
  }
}

/* ----------------------------- Reverse Geocode ---------------------------- */
export async function reverseGeocode({ latitude, longitude }) {
  const url = `${BASE}/geocode/json?latlng=${latitude},${longitude}&key=${KEY}&language=tr`;
  const res = await fetch(url);
  const json = await res.json();
  return json.results || [];
}

export async function getAddressFromCoords(lat, lng) {
  const url = `${BASE}/geocode/json?latlng=${lat},${lng}&key=${KEY}&language=tr`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' || !json.results?.length) return null;
  const best = json.results[0];
  return {
    address: best.formatted_address,
    place_id: best.place_id,
    coordinate: { latitude: lat, longitude: lng },
  };
}

/* ------------------------ Nearby (route-corridor aware) ------------------- */
/**
 * Yeni imza:
 *   getNearbyPlaces({ location:{lat,lng}, radius=650, type, query/keyword, openNow=false })
 * Geri uyum:
 *   getNearbyPlaces(center, keyword)
 */
export async function getNearbyPlaces(arg1, maybeKeyword) {
  // ---- Yeni imza
  if (arg1 && typeof arg1 === 'object' && 'location' in arg1) {
    const {
      location,
      radius = 650,
      type = undefined,
      query = undefined,
      keyword = undefined,
      openNow = false,
    } = arg1;

    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return [];

    const kw = (query ?? keyword ?? '').trim();

    const params = new URLSearchParams({
      location: `${location.lat},${location.lng}`,
      radius: String(radius),
      key: KEY,
      language: 'tr',
    });
    if (type) params.append('type', type);
    if (kw) params.append('keyword', kw);
    if (openNow) params.append('opennow', 'true');

    const url = `${BASE}/place/nearbysearch/json?${params.toString()}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
        console.warn('nearby hata:', json.status, json.error_message);
      }
      // normalize
      return results.map(p => ({
        ...p,
        id: p.place_id,
        place_id: p.place_id,
        name: p.name,
        address: p.vicinity,
        rating: p.rating,
        types: p.types,
        geometry: { location: { lat: p.geometry?.location?.lat, lng: p.geometry?.location?.lng } },
        coords: p.geometry?.location
          ? { latitude: p.geometry.location.lat, longitude: p.geometry.location.lng }
          : null,
        opening_hours: p.opening_hours,
      }));
    } catch (e) {
      console.error('nearbysearch error:', e?.message || e);
      return [];
    }
  }

  // ---- Eski imza
  const center = arg1;
  const keywordStr = (maybeKeyword ?? '').trim();
  if (!center) return [];

  const lat = center.lat ?? center.latitude;
  const lng = center.lng ?? center.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  return getNearbyPlaces({
    location: { lat, lng },
    radius: 600,
    keyword: keywordStr || undefined,
  });
}

/**
 * Hub arayıcı (dünya geneli): type = airport | train_station | bus_station | car_rental | parking
 */
export async function nearbyHubs({ lat, lng, type, radius }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !type) return [];
  const r = radius ?? (type === 'airport' ? 100_000 : 30_000);
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: r.toString(),
    type,
    language: 'tr',
    key: KEY,
  });
  try {
    const res = await fetch(`${BASE}/place/nearbysearch/json?${params.toString()}`);
    const json = await res.json();
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      console.warn('nearbyHubs:', json.status, json?.error_message);
      return [];
    }
    return (json.results || []).map(x => ({
      place_id: x.place_id,
      name: x.name,
      rating: x.rating,
      user_ratings_total: x.user_ratings_total,
      vicinity: x.vicinity,
      location: x.geometry?.location, // {lat,lng}
    }));
  } catch (e) {
    console.error('🌐 nearbyHubs error:', e?.message || e);
    return [];
  }
}

/* --------------------------- Directions / Routing ------------------------- */
function getBoundsFromCoords(coords = []) {
  if (!coords.length) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  coords.forEach(c => {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  });
  return {
    sw: { latitude: minLat, longitude: minLng },
    ne: { latitude: maxLat, longitude: maxLng },
  };
}

function buildDirectionsUrl(originIn, destinationIn, mode = 'driving', extra = {}) {
  const origin = pickLL(originIn);
  const destination = pickLL(destinationIn);
  if (!origin || !destination) return null;

  const originStr = `${origin.latitude},${origin.longitude}`;
  const destinationStr = `${destination.latitude},${destination.longitude}`;

  const params = new URLSearchParams({
    origin: originStr,
    destination: destinationStr,
    mode,
    alternatives: extra.alternatives ? 'true' : 'false',
    key: KEY,
    language: 'tr',
  });

  // küçük tercih ayarları
  const avoidSet = new Set();
  if (mode === 'walking') {
    avoidSet.add('highways');
  } else if (mode === 'driving') {
    params.append('departure_time', 'now'); // canlı trafik
    avoidSet.add('ferries');
    if (extra.avoidTolls) avoidSet.add('tolls');
    if (extra.trafficModel) params.append('traffic_model', String(extra.trafficModel));
  } else if (mode === 'transit') {
    params.append('departure_time', 'now');
  }
  if (avoidSet.size) params.append('avoid', Array.from(avoidSet).join('|'));

  // --- WAYPOINT SERİALİZASYON ---
  const serializeWaypoints = (raw, { optimize = false } = {}) => {
    const list = Array.isArray(raw) ? raw : [];
    const tokens = [];

    for (const w of list) {
      if (!w) continue;

      // 1) String türü → aynen al, optimize:false ise via: ile başlat
      if (typeof w === 'string') {
        let tok = w.trim();
        if (!tok) continue;
        if (!optimize && !/^via:/i.test(tok)) tok = `via:${tok}`;
        tokens.push(tok);
        continue;
      }

      // 2) Array [lat,lng]
      if (Array.isArray(w) && w.length >= 2 && Number.isFinite(w[0]) && Number.isFinite(w[1])) {
        let tok = `${w[0]},${w[1]}`;
        if (!optimize) tok = `via:${tok}`;
        tokens.push(tok);
        continue;
      }

      // 3) Object
      const placeId = w.place_id || w.placeId || w.id || null;
      const loc     = w.location || w.coords || w.coordinate || w;
      const lt      = loc?.lat ?? loc?.latitude;
      const lg      = loc?.lng ?? loc?.longitude;

      if (placeId) {
        let tok = `place_id:${placeId}`;
        if (!optimize) tok = `via:${tok}`;
        tokens.push(tok);
        continue;
      }

      if (Number.isFinite(lt) && Number.isFinite(lg)) {
        let tok = `${lt},${lg}`;
        if (!optimize) tok = `via:${tok}`;
        tokens.push(tok);
      }
    }

    if (!tokens.length) return null;

    // optimize:true → via: kullanmayız, "optimize:true|" prefix’i ekleriz
    if (optimize) {
      return `optimize:true|${tokens.map(t => t.replace(/^via:/i, '')).join('|')}`;
    }
    return tokens.join('|');
  };

  // waypoints kaynakları: waypoints, viaWaypoints, waypointsLL (ilk dolu olan kullanılır)
  let wpParam = null;

  if (Array.isArray(extra.waypoints) && extra.waypoints.length) {
    wpParam = serializeWaypoints(extra.waypoints, { optimize: !!extra.optimize });
  }
  if (!wpParam && Array.isArray(extra.viaWaypoints) && extra.viaWaypoints.length) {
    // viaWaypoints her hâlükârda "via:" olarak gider (optimize=no)
    wpParam = serializeWaypoints(extra.viaWaypoints, { optimize: false });
  }
  if (!wpParam && Array.isArray(extra.waypointsLL) && extra.waypointsLL.length) {
    wpParam = serializeWaypoints(extra.waypointsLL, { optimize: !!extra.optimize });
  }

  if (wpParam) params.append('waypoints', wpParam);

  return `${BASE}/directions/json?${params.toString()}`;
}

/**
 * Google Directions – her zaman LİSTE döndürür.
 */
export async function getRoute(origin, destination, mode = 'driving', opts = {}) {
  try {
    const hasWps =
      (Array.isArray(opts.waypoints)    && opts.waypoints.length > 0) ||
      (Array.isArray(opts.viaWaypoints) && opts.viaWaypoints.length > 0) ||
      (Array.isArray(opts.waypointsLL)  && opts.waypointsLL.length  > 0);

    // Transit modunda waypoints desteklenmez → otomatik driving'e düş
    const effectiveMode = (mode === 'transit' && hasWps) ? 'driving' : mode;

    // alternatives: waypoint varsa default false, yoksa true
    const alternatives = (opts.alternatives != null) ? opts.alternatives : !hasWps;

    const url = buildDirectionsUrl(origin, destination, effectiveMode, {
      alternatives,
      waypoints:    opts.waypoints    || [],
      viaWaypoints: opts.viaWaypoints || [],
      waypointsLL:  opts.waypointsLL  || [],
      optimize:     opts.optimize === true,
      avoidTolls:   opts.avoidTolls === true,
      trafficModel: opts.trafficModel,
    });

    if (!url) {
      console.warn('❌ Directions input invalid:', origin, destination);
      return [];
    }

    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== 'OK') {
      console.warn('❌ Directions API:', json.status, json?.error_message);
      return [];
    }

    const mapped = (json.routes || []).map((route, index) => {
      const overviewPoly = route.overview_polyline?.points || '';
      const decoded = decodePolyline(overviewPoly);
      const lineCoords = decoded.map(p => [p.longitude, p.latitude]); // [lng,lat]
      const legs = Array.isArray(route.legs) ? route.legs : [];

      const totalDistance = legs.reduce((s, l) => s + (l.distance?.value || 0), 0);
      const totalDuration = legs.reduce((s, l) =>
        s + (l.duration_in_traffic?.value ?? l.duration?.value ?? 0), 0);

      const steps = legs.flatMap((leg, legIdx) => {
        const legSteps = Array.isArray(leg.steps) ? leg.steps : [];
        return legSteps.map(s => {
          const stepPoly = s.polyline?.points || null;
          const stepDec = stepPoly ? decodePolyline(stepPoly) : [];
          const stepCoords = stepDec.length ? stepDec.map(p => [p.longitude, p.latitude]) : undefined;

          let type = null, modifier = null;
          if (typeof s.maneuver === 'string') {
            const parts = s.maneuver.split('-');
            type = parts[0] || null;
            modifier = parts[1] || null;
          }

          let bearing_after = undefined;
          if (stepCoords && stepCoords.length >= 2) {
            const a = { lat: stepCoords[stepCoords.length - 2][1], lng: stepCoords[stepCoords.length - 2][0] };
            const b = { lat: stepCoords[stepCoords.length - 1][1], lng: stepCoords[stepCoords.length - 1][0] };
            bearing_after = bearingDeg(a, b);
          }

          return {
            legIndex: legIdx,
            distance: s.distance?.value ?? null,
            duration: s.duration?.value ?? null,
            polyline: stepPoly || null,
            geometry: stepCoords ? { type: 'LineString', coordinates: stepCoords } : undefined,
            maneuver: {
              instruction: (s.html_instructions || '').replace(/<[^>]+>/g, ''),
              type, modifier,
              location: s.end_location ? [s.end_location.lng, s.end_location.lat] : undefined,
              bearing_after,
            },
            start_location: s.start_location,
            end_location: s.end_location,
          };
        });
      });

      return {
        id: String(index),
        distance: totalDistance,
        duration: totalDuration,
        polyline: overviewPoly,
        geometry: { type: 'LineString', coordinates: lineCoords },
        decodedCoords: decoded,
        steps,
        mode: effectiveMode,
        bounds: getBoundsFromCoords(decoded),
        summary: route.summary,
        warnings: route.warnings || [],
        legs,
        waypointOrder: route.waypoint_order || null,
      };
    });

    return mapped;
  } catch (e) {
    console.error('🟥 getRoute error:', e?.message || e);
    return [];
  }
}

/* ---------------------------- Mapbox turn-by-turn ------------------------- */
/** Step’leri Mapbox’tan çekmek için (geometri gerekli olduğunda) */
export const getTurnByTurnSteps = async (from, to) => {
  const f = pickLL(from);
  const t = pickLL(to);
  if (!f || !t) return [];

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${f.lng},${f.lat};${t.lng},${t.lat}` +
    `?steps=true&geometries=geojson&language=tr&access_token=${MAPBOX_ACCESS_TOKEN}`;

  try {
    const response = await axios.get(url);
    const route = response.data.routes?.[0];
    const leg = route?.legs?.[0];
    const steps = Array.isArray(leg?.steps) ? leg.steps : [];
    return steps;
  } catch (error) {
    console.error('🛑 Error fetching navigation steps:', error?.message || error);
    return [];
  }
};
