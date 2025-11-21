// server/services/googleMaps.js
const axios = require('axios');

// Env'den Google key'i daha esnek çek
const GOOGLE_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_PLACES_KEY ||
  process.env.PLACES_API_KEY;

if (!GOOGLE_KEY) {
  console.warn(
    '[googleMaps] Uyarı: GOOGLE_MAPS_API_KEY / GOOGLE_PLACES_KEY / PLACES_API_KEY hiçbiri tanımlı değil!'
  );
}

/**
 * Basit Google Directions çağrısı.
 * from / to = "lat,lng" string
 * mode = driving|walking|bicycling|transit
 */
async function getRoute(from, to, mode = 'driving') {
  if (!GOOGLE_KEY) {
    throw new Error(
      'Google Directions için API key bulunamadı. Lütfen .env içinde GOOGLE_MAPS_API_KEY veya GOOGLE_PLACES_KEY veya PLACES_API_KEY tanımla.'
    );
  }

  // Güvenli encode
  const origin = encodeURIComponent(from);
  const destination = encodeURIComponent(to);

  const params = new URLSearchParams();
  params.set('origin', from); // Google "lat,lng" formatını zaten seviyor
  params.set('destination', to);
  params.set('mode', mode);
  params.set('key', GOOGLE_KEY);
  params.set('departure_time', 'now'); // trafik / transit için daha akıllı süre

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;

  const response = await axios.get(url);
  const data = response.data;

  if (data.status !== 'OK') {
    const msg = data.error_message || data.status || 'Directions error';
    const err = new Error(msg);
    err.code = data.status;
    throw err;
  }

  // Burada raw JSON'u döndürüyoruz.
  // server/routes/directions.js içinde zaten
  // overview_polyline'dan polyline'ı çıkarıyoruz.
  return data;
}

module.exports = { getRoute };
