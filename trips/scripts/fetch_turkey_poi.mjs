// fetch_turkey_poi.mjs
// Türkiye geneli POI toplama (OSM Overpass)
// node fetch_turkey_poi.mjs

import fs from "fs";

// Birkaç ayna uç nokta
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// İl bazında sorgulayacağımız ortak filtre
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

/** Ülke → iller (admin_level=4) alanlarını getirir (area id + name). */
function buildQueryListProvinces() {
  return `
[out:json][timeout:180];
area["name"="Türkiye"]["boundary"="administrative"]["admin_level"="2"]->.country;
rel(area.country)["boundary"="administrative"]["admin_level"="4"]->.rels;
(.rels; map_to_area;)->.areas;
.areas out ids tags;`;
}

/** Verilen areaId için POI sorgusu */
function buildQueryForArea(areaId) {
  return `
[out:json][timeout:120];
area(${areaId})->.searchArea;
(
${CORE_FILTER}
);
out center tags;`;
}

async function callOverpass(query, label = "") {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
      const json = await res.json();
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`[warn] ${label} ${e.message}`);
      // küçük bekleme
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

function toRow(el, provinceName = "") {
  const t = el.type;
  const tags = el.tags || {};
  const name = tags.name || "";
  let lat, lon;
  if (t === "node") {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lon = el.center.lon;
  }
  return {
    province: provinceName || "",
    name,
    lat,
    lon,
    type: t,
    id: el.id,
    amenity: tags.amenity || "",
    shop: tags.shop || "",
    tourism: tags.tourism || "",
  };
}

function writeCSV(rows, file = "turkey_poi.csv") {
  const header = ["province", "name", "lat", "lon", "type", "id", "amenity", "shop", "tourism"];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
  fs.writeFileSync(file, csv, "utf-8");
  return file;
}

function normTr(s) {
  return String(s ?? "")
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => ({
      İ: "i",
      I: "i",
      ı: "i",
      Ş: "s",
      ş: "s",
      Ğ: "g",
      ğ: "g",
      Ü: "u",
      ü: "u",
      Ö: "o",
      ö: "o",
      Ç: "c",
      ç: "c",
    }[ch] || ch))
    .toLowerCase()
    .trim();
}

async function main() {
  console.log(">> İller listesi çekiliyor…");
  const provinceListRes = await callOverpass(buildQueryListProvinces(), "[listProvinces]");
  const provinceAreas = (provinceListRes?.elements || [])
    .filter((e) => e.type === "area")
    .map((e) => ({
      areaId: e.id,
      name: e.tags?.name || "",
    }))
    // bazen yinelenen/çeşitli ad varyantları olabilir — alan id eşsizdir
    .filter((x) => x.areaId && x.name);

  if (provinceAreas.length === 0) {
    throw new Error("İl (admin_level=4) alanları bulunamadı.");
  }

  // İl isimlerine göre sıralayalım (stabil çıktı için)
  provinceAreas.sort((a, b) => normTr(a.name).localeCompare(normTr(b.name)));

  console.log(`>> ${provinceAreas.length} il bulundu. Her il için POI sorgulanacak…`);

  const dedupe = new Set(); // `${type}/${id}`
  const allRows = [];

  // Her il için sırayla sorgu (Overpass'i yormamak adına paralel yapmıyoruz)
  for (let i = 0; i < provinceAreas.length; i++) {
    const { areaId, name } = provinceAreas[i];
    const label = `[${i + 1}/${provinceAreas.length}] ${name}`;
    try {
      console.log(`>> ${label} → sorgu gönderiliyor…`);
      const data = await callOverpass(buildQueryForArea(areaId), label);
      const elements = data?.elements ?? [];
      console.log(`   ${label} → ${elements.length} öğe`);

      for (const el of elements) {
        const key = `${el.type}/${el.id}`;
        if (dedupe.has(key)) continue;
        const row = toRow(el, name);
        if (row.name && row.lat && row.lon) {
          dedupe.add(key);
          allRows.push(row);
        }
      }

      // her istek arası kısa bekleme (Overpass kuralları)
      await new Promise((r) => setTimeout(r, 900));
    } catch (err) {
      console.warn(`!! ${label} hata: ${err.message}`);
      // Devam ediyoruz; eksik iller için tekrar çalıştırılabilir
    }
  }

  console.log(`>> Toplam benzersiz kayıt: ${allRows.length}`);
  const out = writeCSV(allRows, "turkey_poi.csv");
  console.log(`>> Yazıldı: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
