// fetch_ankara_poi.mjs
import fs from "fs";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const CORE_FILTER = `
  // Yeme-içme
  node["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](area.searchArea);
  way ["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](area.searchArea);
  rel ["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](area.searchArea);

  // Tatlıcı / pastane
  node["shop"~"^(confectionery|pastry|bakery)$"]["name"](area.searchArea);
  way ["shop"~"^(confectionery|pastry|bakery)$"]["name"](area.searchArea);
  rel ["shop"~"^(confectionery|pastry|bakery)$"]["name"](area.searchArea);

  // Turistik yerler
  node["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](area.searchArea);
  way ["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](area.searchArea);
  rel ["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](area.searchArea);
`;

/** 1) Ankara'yı geocodeArea ile bulur (en sağlam yöntem) */
function buildQueryGeocodeArea() {
  return `
[out:json][timeout:90];
{{geocodeArea:Ankara}}->.searchArea;
(
${CORE_FILTER}
);
out center tags;`;
}

/** 2) Admin-level fallback (il=4 + merkez ilçe=6/8) */
function buildQueryAdminLevels() {
  return `
[out:json][timeout:90];
// İl (admin_level=4) veya merkez ilçeler (6/8) eşleşsin
(
  area["name"="Ankara"]["boundary"="administrative"]["admin_level"="4"];
  area["name"="Çankaya"]["boundary"="administrative"]["admin_level"~"6|8"];
  area["name"="Yenimahalle"]["boundary"="administrative"]["admin_level"~"6|8"];
  area["name"="Keçiören"]["boundary"="administrative"]["admin_level"~"6|8"];
  area["name"="Mamak"]["boundary"="administrative"]["admin_level"~"6|8"];
  area["name"="Altındağ"]["boundary"="administrative"]["admin_level"~"6|8"];
)->.A;
(.A;)->.searchArea;
(
${CORE_FILTER}
);
out center tags;`;
}

/** 3) BBox fallback (Ankara çevresi yaklaşık; istersen daraltabilirsin) */
function buildQueryBBox() {
  // Yaklaşık bbox: [minLon, minLat, maxLon, maxLat]
  // Ankara için kaba sınırlar (gerekirse daralt: örn. 39.75–40.05 lat, 32.6–33.0 lon)
  const minLat = 39.55, minLon = 32.40, maxLat = 40.20, maxLon = 33.10;
  return `
[out:json][timeout:120];
(
  node["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  way ["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  rel ["amenity"~"^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});

  node["shop"~"^(confectionery|pastry|bakery)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  way ["shop"~"^(confectionery|pastry|bakery)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  rel ["shop"~"^(confectionery|pastry|bakery)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});

  node["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  way ["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
  rel ["tourism"~"^(attraction|museum|gallery|artwork|viewpoint|theme_park|zoo)$"]["name"](${minLat},${minLon},${maxLat},${maxLon});
);
out center tags;`;
}

function toRow(el) {
  const t = el.type;
  const tags = el.tags || {};
  const name = tags.name || "";
  let lat, lon;
  if (t === "node") { lat = el.lat; lon = el.lon; }
  else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
  return {
    name,
    lat, lon,
    type: t, id: el.id,
    amenity: tags.amenity || "",
    shop: tags.shop || "",
    tourism: tags.tourism || "",
  };
}

async function callOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
      const json = await res.json();
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`[warn] ${e.message}`);
      // küçük bir bekleme
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

function writeCSV(rows, file = "ankara_poi.csv") {
  const header = ["name","lat","lon","type","id","amenity","shop","tourism"];
  const csv = [
    header.join(","),
    ...rows.map(r => header.map(h => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(","))
  ].join("\n");
  fs.writeFileSync(file, csv, "utf-8");
  return file;
}

async function main() {
  console.log("Fetching from Overpass… (geocodeArea)");
  let data = await callOverpass(buildQueryGeocodeArea()).catch(() => null);

  let elements = data?.elements ?? [];
  console.log(`geocodeArea -> elements: ${elements.length}`);

  if (elements.length === 0) {
    console.log("Fallback → admin_level areas…");
    data = await callOverpass(buildQueryAdminLevels()).catch(() => null);
    elements = data?.elements ?? [];
    console.log(`admin_levels -> elements: ${elements.length}`);
  }

  if (elements.length === 0) {
    console.log("Fallback → bbox…");
    data = await callOverpass(buildQueryBBox()).catch(() => null);
    elements = data?.elements ?? [];
    console.log(`bbox -> elements: ${elements.length}`);
  }

  const rows = elements.map(toRow).filter(r => r.name && r.lat && r.lon);
  const out = writeCSV(rows);
  console.log(`Wrote ${out} with ${rows.length} rows`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
