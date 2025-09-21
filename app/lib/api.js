// app/lib/api.js
const API_BASE = __DEV__
  ? "http://localhost:4000"     // iOS sim: localhost; Android emülatör: 10.0.2.2
  : "https://navigation-server.onrender.com"; // prod

// NOT: Android emülatörde test ediyorsan API_BASE = "http://10.0.2.2:5000" yap.

export async function poiSearch(q, { lat, lon, category, city }) {
  const url = `${API_BASE}/api/poi/google/search` +
    `?q=${encodeURIComponent(q)}` +
    `&lat=${lat}&lon=${lon}` +
    `&city=${encodeURIComponent(city||"")}` +
    `&category=${encodeURIComponent(category||"")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("poiSearch_failed");
  return res.json(); // [{source:'google', name, lat, lon, place_id}, ...]
}

export async function poiMatch(items, city) {
  const res = await fetch(`${API_BASE}/api/poi/match`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      items: items.map(x => ({
        osm_id: x.osm_id,
        name: x.name,
        lat: x.lat,
        lon: x.lon,
        city: city || "Ankara",
      }))
    })
  });
  if (!res.ok) throw new Error("poiMatch_failed");
  return res.json(); // { results: [...] }
}
