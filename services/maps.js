// src/services/maps.js
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import polyline from '@mapbox/polyline';

const BASE = 'https://maps.googleapis.com/maps/api';

function formatPlaceType(types = []) {
  const PRIORITY = ['cafe', 'restaurant', 'bar', 'hotel', 'museum', 'library', 'bakery', 'pharmacy'];
  const match = PRIORITY.find(type => types.includes(type));
  return match || types[0] || 'place';
}

export async function autocomplete(input, { lat, lng } = {}) {
  console.log('🌐 autocomplete çağrıldı:', input);
  const params = new URLSearchParams({
    input,
    key: KEY,
    language: 'tr',
    ...(lat && lng ? { location: `${lat},${lng}`, radius: '50000' } : {}),
  });
  const res = await fetch(`${BASE}/place/autocomplete/json?${params}`);
  const json = await res.json();
  console.log('🌐 autocomplete cevap:', json.status, json.predictions?.length);
  return json.status === 'OK' ? json.predictions : [];
}

export async function getPlaceDetails(placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: [
      'name',
      'formatted_address',
      'geometry',
      'photos',
      'website',
      'formatted_phone_number',
      'rating',
      'price_level',
      'opening_hours',
      'reviews',
      'types',
      'url',
    ].join(','),
    key: KEY,
    language: 'tr',
  });

  try {
    const res = await fetch(`${BASE}/place/details/json?${params}`);
    const json = await res.json();

    if (json.status !== 'OK') {
      console.error('🟥 getPlaceDetails hata:', json.status);
      return null;
    }

    const r = json.result;
    const photoUrls = (r.photos || []).map(p =>
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${p.photo_reference}&key=${KEY}`
    );
    console.log('📸 Fotoğraf URLleri sayısı:', photoUrls.length);

    const { lat, lng } = r.geometry.location;

    return {
      name: r.name,
      address: r.formatted_address,
      website: r.website || null,
      phone: r.formatted_phone_number || null,
      rating: r.rating || null,
      priceLevel: r.price_level ?? null,
      openNow: r.opening_hours?.open_now ?? null,
      hoursToday: r.opening_hours?.weekday_text ?? [],
      photos: photoUrls,
      reviews: r.reviews || [],
      types: r.types || [],
      typeName: formatPlaceType(r.types),
      coords: { latitude: lat, longitude: lng },
      url: r.url || null,
    };
  } catch (err) {
    console.error('🟥 getPlaceDetails fetch hatası:', err);
    return null;
  }
}

export async function getAddressFromCoords(lat, lng) {
  const url = `${BASE}/geocode/json?latlng=${lat},${lng}&key=${KEY}&language=tr`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' || !json.results.length) return null;
  const best = json.results[0];
  return {
    address: best.formatted_address,
    place_id: best.place_id,
    coordinate: { latitude: lat, longitude: lng },
  };
}

export async function getNearbyPlaces(center, keyword) {
  const radius = 500;
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${center.latitude},${center.longitude}&radius=${radius}&keyword=${keyword}&key=${KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.results) return [];
  return json.results.map(place => ({
    place_id: place.place_id,
    name: place.name,
    address: place.vicinity,
    rating: place.rating,
    types: place.types,
    coords: { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng },
  }));
}

export async function getDirections(origin, destination, mode = 'driving') {
  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode,
    key: KEY,
  });
  const res = await fetch(`${BASE}/directions/json?${params}`);
  const json = await res.json();
  console.log('📨 Directions API yanıtı:', JSON.stringify(json, null, 2));
  return json.status === 'OK' ? json.routes[0] : null;
}

export async function getRoute(origin, destination) {
  const raw = await getDirections(origin, destination);
  console.log('📡 getRoute() gelen veri:', raw);

  if (!raw || !raw.legs?.length) {
    console.warn('⚠️ Geçersiz rota yanıtı:', raw);
    return null;
  }

  const leg = raw.legs[0];
  return {
    distance: leg.distance?.text || '',
    duration: leg.duration?.text || '',
    polyline: raw.overview_polyline?.points || '',
  };
}

export function decodePolyline(encoded) {
  try {
    const points = polyline.decode(encoded);
    return points.map(([latitude, longitude]) => ({ latitude, longitude }));
  } catch (e) {
    console.warn('❌ decodePolyline failed:', e);
    return [];
  }
}
