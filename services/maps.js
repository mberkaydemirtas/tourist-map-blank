// src/services/maps.js
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import polyline from '@mapbox/polyline';

const BASE = 'https://maps.googleapis.com/maps/api';

// 1) Autocomplete
export async function autocomplete(input, { lat, lng } = {}) {
  const params = new URLSearchParams({
    input,
    key: KEY,
    language: 'tr',
    ...(lat && lng ? { location: `${lat},${lng}`, radius: '50000' } : {}),
  });
  const res = await fetch(`${BASE}/place/autocomplete/json?${params}`);
  const json = await res.json();
  return json.status === 'OK' ? json.predictions : [];
}

// 2) Place Details
export async function getPlaceDetails(placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,formatted_address,geometry,photos,website',
    key: KEY,
  });
  const res = await fetch(`${BASE}/place/details/json?${params}`);
  const json = await res.json();
  if (json.status !== 'OK') return null;
  const r = json.result;
  return {
    name: r.name,
    address: r.formatted_address,
    website: r.website || null,
    photos: r.photos || [],
    coord: { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng },
  };
}

// 3) Tersine geocoding
export async function getAddressFromCoords(lat, lng) {
  const url = `${BASE}/geocode/json?latlng=${lat},${lng}&key=${KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' || !json.results.length) return null;
  const best = json.results[0];
  return {
    name: best.formatted_address,
    address: best.formatted_address,
    coordinate: { latitude: lat, longitude: lng },
  };
}

// 4) Yakındaki yerler (kategori)
export async function getNearbyPlaces(center, type) {
  const url = `${BASE}/place/nearbysearch/json?location=${center.latitude},${center.longitude}&radius=2000&type=${type}&key=${KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK') return [];
  return json.results.map(p => ({
    id: p.place_id,
    name: p.name,
    coordinate: { latitude: p.geometry.location.lat, longitude: p.geometry.location.lng },
  }));
}

// 5) Raw Directions
export async function getDirections(origin, destination, mode = 'driving') {
  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode,
    key: KEY,
  });
  const res = await fetch(`${BASE}/directions/json?${params}`);
  const json = await res.json();
  return json.status === 'OK' ? json.routes[0] : null;
}

// 6) Rota bilgi
export async function getRoute(origin, destination) {
  const raw = await getDirections(origin, destination);
  if (!raw || !raw.legs?.length) return null;
  const leg = raw.legs[0];
  return {
    distance: leg.distance.text,
    duration: leg.duration.text,
    polyline: raw.overview_polyline.points,
  };
}

// 7) Polyline decode helper
export function decodePolyline(points) {
  return polyline.decode(points).map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}
