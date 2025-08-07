// src/services/maps.js
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import polyline from '@mapbox/polyline';
import axios from 'axios';
import { MAPBOX_ACCESS_TOKEN } from '@env';

const BASE = 'https://maps.googleapis.com/maps/api';

function formatPlaceType(types = []) {
  const PRIORITY = ['cafe', 'restaurant', 'bar', 'hotel', 'museum', 'library', 'bakery', 'pharmacy'];
  const match = PRIORITY.find(type => types.includes(type));
  return match || types[0] || 'place';
}
function buildDirectionsUrl(origin, destination, mode = 'driving') {
  const originStr = `${origin.latitude},${origin.longitude}`;
  const destinationStr = `${destination.latitude},${destination.longitude}`;

  const params = new URLSearchParams({
    origin: originStr,
    destination: destinationStr,
    mode,
    alternatives: 'true', // ✅ alternatif rotalar
    key: KEY,
  });

  if (mode === 'walking') {
    params.append('avoid', 'highways');
  } else if (mode === 'driving') {
    params.append('avoid', 'tolls|ferries');
  } else if (mode === 'transit') {
    params.append('avoid', 'highways');
    params.append('departure_time', 'now');
  }

  return `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
}

export async function autocomplete(input, { lat, lng } = {}) {
  console.log('🌐 autocomplete çağrıldı:', input);
  const params = new URLSearchParams({
    input,
    key: KEY,
    language: 'tr',
  });
  if (lat && lng) {
    params.append('location', `${lat},${lng}`);
    params.append('radius', '2000');
  }
  const url = `${BASE}/place/autocomplete/json?${params.toString()}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    console.log('🌐 autocomplete cevap:', json.status, json.predictions?.length);
    if (json.status !== 'OK') {
      console.warn('❌ autocomplete hatalı cevap:', json.status);
      return [];
    }
    return json.predictions;
  } catch (err) {
    console.error('🌐 autocomplete fetch hatası:', err);
    return [];
  }
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

export const getTurnByTurnSteps = async (from, to) => {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?steps=true&geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`;

  try {
    const response = await axios.get(url);
    const steps = response.data.routes[0].legs[0].steps;
    return steps;
  } catch (error) {
    console.error('🛑 Error fetching navigation steps:', error);
    return [];
  }
};

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

import { GOOGLE_MAPS_API_KEY } from '@env';

// Bu yardımcı fonksiyon artık parametrelerle tüm yönlendirmeyi alır


export async function getRoute(origin, destination, mode = 'driving') {
  const url = buildDirectionsUrl(origin, destination, mode);
  console.log('📡 Directions API isteği:', url);

  const res = await fetch(url);
  const json = await res.json();

  if (json.status !== 'OK') {
    console.warn('❌ Directions API hatalı cevap:', json.status, json.error_message);
    return null;
  }

  // 🔁 Tüm alternatif rotaları işle
  const processedRoutes = json.routes.map((route, index) => {
    const leg = route.legs[0];
    const polylineStr = route.overview_polyline?.points || '';
    const decoded = decodePolyline(polylineStr);

    const mappedSteps = leg?.steps?.map(step => ({
      maneuver: {
        instruction: step.html_instructions?.replace(/<[^>]+>/g, ''),
        location: [
          step.end_location.lng,
          step.end_location.lat
        ]
      },
      distance: step.distance?.value
    })) || [];

    return {
      id: index, // her rotaya bir ID ver
      isprimary: index === 0, // ilk rota ana rota
      distance: leg.distance.text,
      duration: leg.duration.text,
      durationValue: leg.duration.value, // saniye
      polyline: route.overview_polyline.points,
      decodedCoords: decoded,
      steps: mappedSteps,
      mode,
    };
  });

  console.log('🗺️ Alternatif rota sayısı:', processedRoutes.length);

  return processedRoutes;
}

export function decodePolyline(encoded) {
  try {
    console.log('🧪 Gelen polyline:', encoded);
    const points = polyline.decode(encoded);
    const result = points.map(([latitude, longitude]) => ({ latitude, longitude }));
    console.log('🧪 Decode edilen nokta sayısı:', result.length);
    return result;
  } catch (e) {
    console.warn('❌ decodePolyline failed:', e);
    return [];
  }
}
export async function reverseGeocode({ latitude, longitude }) {
  const url = `${BASE}/geocode/json?latlng=${latitude},${longitude}&key=${KEY}&language=tr`;
  const res = await fetch(url);
  const json = await res.json();
  return json.results || [];
}


