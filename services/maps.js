// src/services/maps.js

const BASE = 'https://maps.googleapis.com/maps/api';
const KEY  = process.env.GOOGLE_MAPS_API_KEY;

// 1) Autocomplete
export async function autocomplete(input, { lat, lng } = {}) {
  const params = new URLSearchParams({
    input,
    key: KEY,
    language: 'tr',
    ...(lat && lng ? { location: `${lat},${lng}`, radius: '50000' } : {})
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
    key: KEY
  });
  const res  = await fetch(`${BASE}/place/details/json?${params}`);
  const json = await res.json();
  if (json.status !== 'OK') return null;
  const r = json.result;
  return {
    name:    r.name,
    address: r.formatted_address,
    website: r.website || null,
    photos:  r.photos || [],
    coord:   r.geometry.location,
  };
}

// 3) Directions
export async function getDirections(origin, destination, mode = 'driving') {
  const params = new URLSearchParams({
    origin:      `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode,
    key:         KEY,
  });
  const res  = await fetch(`${BASE}/directions/json?${params}`);
  const json = await res.json();
  return json.status === 'OK' ? json.routes[0] : null;
}
