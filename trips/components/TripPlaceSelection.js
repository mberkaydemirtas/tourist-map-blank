// components/TripPlaceSelection.js
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, FlatList, Pressable, ScrollView } from "react-native";

// ---- KATEGORİ TANIMLARI ----
const CATEGORIES = [
  { key: "touristic", label: "Turistik", osmMatch: (r) => !!r.tourism || ["artwork","viewpoint","attraction","museum","gallery","zoo","theme_park"].includes((r.tourism||"").toLowerCase()) },
  { key: "restaurant", label: "Restoran", osmMatch: (r) => (r.amenity||"").toLowerCase()==="restaurant" },
  { key: "bar", label: "Bar/Pub", osmMatch: (r) => ["bar","pub","nightclub"].includes((r.amenity||"").toLowerCase()) },
  { key: "cafe", label: "Kafe", osmMatch: (r) => (r.amenity||"").toLowerCase()==="cafe" },
  { key: "bakery", label: "Pastane/Tatlıcı", osmMatch: (r) => ["bakery","confectionery","pastry","patisserie"].includes((r.shop||"").toLowerCase()) },
  { key: "museum", label: "Müze/Galeri", osmMatch: (r) => ["museum","gallery","artwork"].includes((r.tourism||"").toLowerCase()) },
  { key: "park", label: "Park", osmMatch: (r) => (r.leisure||"").toLowerCase()==="park" }, // leisure alanı OSM’de; seed’de yoksa boş gelir
];

// ---- TR-normalizasyon + basit benzerlik ----
const trFold = (s="") => s.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[İIı]/g,"i").replace(/Ş/g,"s").replace(/ş/g,"s")
  .replace(/Ğ/g,"g").replace(/ğ/g,"g")
  .replace(/Ü/g,"u").replace(/ü/g,"u")
  .replace(/Ö/g,"o").replace(/ö/g,"o")
  .replace(/Ç/g,"c").replace(/ç/g,"c")
  .toLowerCase().replace(/\s+/g," ").trim();

const includesLoose = (hay, needle) => trFold(hay).includes(trFold(needle));

const ngrams = (s, n=3) => {
  const t = ` ${trFold(s)} `;
  const out = [];
  for (let i=0;i<=t.length-n;i++) out.push(t.slice(i,i+n));
  return out;
};
const trigramSim = (a,b) => {
  const A = new Set(ngrams(a,3)), B = new Set(ngrams(b,3));
  if (!A.size || !B.size) return 0;
  let inter=0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(A.size,B.size);
};

// ---- CSV seed (DEMO) ----
function seedFromCsv() {
  const raw = `name,lat,lon,type,id,amenity,shop,tourism
"Cumhuriyet Fırını","39.9575254","32.7004355","node","29474203","restaurant","bakery",""
"Konyalı Kebap","39.9038863","32.8137266","node","60166115","restaurant","",""
"Quick China","39.8715794","32.6820882","node","60580757","restaurant","",""
"İncek Sofrası","39.8113785","32.7101463","node","60580767","restaurant","",""
"Karacaoğlu","39.8132025","32.7127677","node","60580768","restaurant","",""
"Mantar","39.8791119","32.8608287","node","60580779","restaurant","",""
"Hill Fırın","39.8847896","32.8522128","node","60580784","","bakery",""
"Beykoz","39.884752","32.8534031","node","60581036","restaurant","",""
"Çorbacı Hasan Usta","39.8852694","32.8545145","node","60581240","restaurant","technology",""
"Tadım Pizza","39.8947605","32.8499683","node","60582717","fast_food","",""
"Saklıbahçe","39.9148117","32.8044537","node","60582754","restaurant","",""
"Quick China","39.8959322","32.8780299","node","60582768","restaurant","",""
"Liva","39.9318643","32.8255812","node","62673818","","pastry",""
"Mado","39.9027817","32.860248","node","62673925","cafe","patisserie",""
"Liman Restoran","39.8929116","32.8560433","node","62674002","restaurant","",""
"C'ViZ","39.8915594","32.8711121","node","62674094","cafe","",""
"Halk Ekmek","39.9226673","32.870808","node","93980558","","bakery",""
"Halk Ekmek","39.919056","32.8760354","node","93980564","","bakery",""
"Cafe des Cafes","39.9066216","32.8612044","node","93807636","cafe","",""
"Chocolatier d'Orient","39.8938389","32.8767339","node","75343404","","pastry",""`;
  const lines = raw.split(/\r?\n/).slice(1).filter(Boolean);
  const parse = (line) => {
    // çok basit CSV parser (çift tırnak destekli)
    const out=[]; let cur="", inQ=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (inQ){
        if (ch === '"' && line[i+1] === '"'){ cur+='"'; i++; }
        else if (ch === '"'){ inQ=false; }
        else cur+=ch;
      } else {
        if (ch === ','){ out.push(cur); cur=""; }
        else if (ch === '"'){ inQ=true; }
        else cur+=ch;
      }
    }
    out.push(cur);
    return out;
  };
  return lines.map(line => {
    const [name, lat, lon, type, id, amenity, shop, tourism] = parse(line);
    return {
      source: "osm",
      osm_id: id,
      name,
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      amenity, shop, tourism,
    };
  });
}

// ---- Yardımcı: kategoriye göre filtrele ----
const filterByCategory = (rows, catKey) => {
  const cat = CATEGORIES.find(c => c.key === catKey);
  if (!cat) return rows;
  return rows.filter(cat.osmMatch);
};

// ---- Bileşen ----
/**
 * Props:
 *  - city: "ankara" gibi
 *  - initialData: OSM/DB’den gelen dizi [{source:'osm', name, lat, lon, amenity, shop, tourism, osm_id?}, ...]
 *  - googleSearchFn: async (q, {lat, lon, category, city}) => [{source:'google', name, lat, lon, place_id}, ...]
 *  - onConfirm: (selectedArray) => void
 */
export default function TripPlaceSelection({
  city = "ankara",
  initialData,
  googleSearchFn,
  onConfirm,
}) {
  const [active, setActive] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]); // array of items
  const [list, setList] = useState([]);         // current shown items
  const [loading, setLoading] = useState(false);

  // Demo: initialData yoksa CSV seed
  const baseData = useMemo(() => (initialData && initialData.length ? initialData : seedFromCsv()), [initialData]);

  // Şehir merkezini (bias) istersen prop’tan gönder; şimdilik Ankara Kızılay civarı:
  const cityCenter = useMemo(() => ({ lat: 39.92077, lon: 32.85411 }), []);

  // aktif kategori için top-20 preload
  useEffect(() => {
    const rows = filterByCategory(baseData, active).slice(0, 20);
    setList(rows);
    setQuery("");
  }, [baseData, active]);

  // debounce ile arama
  const timer = useRef();
  const runSearch = useCallback(async (q) => {
    if (!q) {
      setList(filterByCategory(baseData, active).slice(0, 20));
      return;
    }
    setLoading(true);
    try {
      // 1) local search
      let local = filterByCategory(baseData, active)
        .filter(r => includesLoose(r.name, q) || trigramSim(r.name, q) >= 0.6)
        .slice(0, 20);
      if (local.length) {
        setList(local);
        return;
      }
      // 2) google fallback (server üzerinden)
      if (typeof googleSearchFn === "function") {
        const g = await googleSearchFn(q, { lat: cityCenter.lat, lon: cityCenter.lon, category: active, city });
        setList((g || []).slice(0, 20));
      } else {
        setList([]); // server bağlı değilse boş bırak
      }
    } finally {
      setLoading(false);
    }
  }, [baseData, active, city, cityCenter, googleSearchFn]);

  const onChangeQuery = (t) => {
    setQuery(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(t), 280);
  };

  // seçim toggle
  const toggleSelect = (item) => {
    const key = itemKey(item);
    const exists = selected.find(x => itemKey(x) === key);
    if (exists) {
      setSelected(prev => prev.filter(x => itemKey(x) !== key));
    } else {
      setSelected(prev => [...prev, item]);
    }
  };

  const itemKey = (item) => {
    if (item.source === "google" && item.place_id) return `g:${item.place_id}`;
    if (item.source === "osm" && item.osm_id) return `o:${item.osm_id}`;
    // fallback key
    return `${item.source||"x"}:${trFold(item.name)}@${item.lat},${item.lon}`;
  };

  const isChecked = (item) => !!selected.find(x => itemKey(x) === itemKey(item));

  // render
  return (
    <View style={{ flex:1, backgroundColor:"#fff" }}>
      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal:12, paddingTop:12 }}>
        {CATEGORIES.map(cat => {
          const activeTab = cat.key === active;
          return (
            <Pressable key={cat.key} onPress={() => setActive(cat.key)} style={{
              paddingVertical:8, paddingHorizontal:12, borderRadius:16,
              backgroundColor: activeTab ? "#111827" : "#F3F4F6", marginRight:8
            }}>
              <Text style={{ color: activeTab ? "#fff" : "#111827", fontWeight:"600" }}>{cat.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Search */}
      <View style={{ paddingHorizontal:12, paddingTop:10, paddingBottom:6 }}>
        <TextInput
          placeholder="Şehir içinde ara (ör. Kıtır, Trilye, Museum)…"
          value={query}
          onChangeText={onChangeQuery}
          style={{
            backgroundColor:"#F9FAFB",
            borderWidth:1, borderColor:"#E5E7EB",
            borderRadius:12, paddingHorizontal:12, paddingVertical:10
          }}
        />
        <Text style={{ marginTop:6, color:"#6B7280", fontSize:12 }}>
          {loading ? "Aranıyor…" : (query ? "Sonuçlar" : "Öneriler")} — {list.length} öğe
        </Text>
      </View>

      {/* List */}
      <FlatList
        data={list}
        keyExtractor={(item) => itemKey(item)}
        contentContainerStyle={{ padding:12, paddingBottom:120 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => toggleSelect(item)} style={{
            borderWidth:1, borderColor:"#E5E7EB", borderRadius:12, padding:12, marginBottom:10,
            flexDirection:"row", alignItems:"center", justifyContent:"space-between"
          }}>
            <View style={{ flex:1, paddingRight:12 }}>
              <Text style={{ fontWeight:"700", color:"#111827" }} numberOfLines={1}>{item.name}</Text>
              <Text style={{ color:"#6B7280", marginTop:2, fontSize:12 }}>
                {fmtSub(item, active)}
              </Text>
            </View>
            <View style={{
              width:22, height:22, borderRadius:6,
              borderWidth:2, borderColor: isChecked(item) ? "#111827" : "#9CA3AF",
              alignItems:"center", justifyContent:"center", backgroundColor: isChecked(item) ? "#111827" : "transparent"
            }}>
              {isChecked(item) ? <Text style={{ color:"#fff", fontSize:14 }}>✓</Text> : null}
            </View>
          </Pressable>
        )}
      />

      {/* Footer */}
      <View style={{
        position:"absolute", left:0, right:0, bottom:0,
        padding:12, borderTopWidth:1, borderColor:"#E5E7EB", backgroundColor:"#fff"
      }}>
        <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center" }}>
          <Text style={{ color:"#6B7280" }}>Seçili: <Text style={{ fontWeight:"700", color:"#111827" }}>{selected.length}</Text></Text>
          <Pressable
            onPress={() => onConfirm?.(selected)}
            style={{ backgroundColor:"#111827", paddingVertical:12, paddingHorizontal:18, borderRadius:12 }}
          >
            <Text style={{ color:"#fff", fontWeight:"700" }}>Devam et (Rota)</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Alt başlık bilgisi
function fmtSub(item, activeCat){
  const parts = [];
  if (item.source === "google" && item.place_id) parts.push("Google");
  if (item.source === "osm") parts.push("OSM");
  const cat = (item.amenity || item.shop || item.tourism || "").toLowerCase();
  if (cat) parts.push(cat);
  // koordinat (kısa)
  if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
    parts.push(`${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`);
  }
  return parts.join(" · ");
}
