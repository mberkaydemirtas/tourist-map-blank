const axios = require('axios');

async function getRoute(from, to) {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${from}&destination=${to}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const response = await axios.get(url);
  return response.data;
}

module.exports = { getRoute };
