// trips/components/TripListQuestion.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { prewarmPoiShard, getCategoryCounts, searchPoiHybrid } from '../../app/lib/poiHybrid';

// ---- Sekmeler
const CATEGORIES = [
  { key: 'sights',      label: 'Turistik Yerler' },
  { key: 'restaurants', label: 'Restoranlar' },
  { key: 'cafes',       label: 'Kafeler' },
  { key: 'bars',        label: 'Barlar' },
  { key: 'museums',     label: 'Müzeler' },
  { key: 'parks',       label: 'Parklar' },
];

const BTN = '#2563EB';
const BORDER = '#23262F';

/* --------------------------------------------------------------------------
 * JSC/Hermes uyumlu güvenli normalizasyon
 * -------------------------------------------------------------------------- */
const hasNormalize = typeof String.prototype.normalize === 'function';
const safeNormalize = (s) => {
  const str = String(s || '');
  if (!hasNormalize) return str.toLowerCase();
  try {
     return str
       .normalize('NFKD')
       .replace(/[\u0300-\u036f]/g, '')
       .replace(/[İIı]/g, 'i')
       .replace(/Ş/g, 's').replace(/ş/g, 's')
       .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
       .replace(/Ü/g, 'u').replace(/ü/g, 'u')
       .replace(/Ö/g, 'o').replace(/ö/g, 'o')
       .replace(/Ç/g, 'c').replace(/ç/g, 'c')
       .toLowerCase()
       .trim();  } catch {
    return str.toLowerCase();
  }
};
const norm = (s) => safeNormalize(s);
const toNumber = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// CSV satırından olası kolon adlarına bakarak alan seç
function pickField(row, candidates, def = '') {
  for (const c of candidates) {
    if (row[c] != null && String(row[c]).trim() !== '') return row[c];
  }
  return def;
}

// --- CSV kategori eşleme (amenity / shop / tourism / type -> app kategorisi)
function mapCsvRowCategory(row) {
   const amenity = String(row.amenity || '').trim().toLowerCase();
   const tourism = String(row.tourism || '').trim().toLowerCase();
   const shop    = String(row.shop || '').trim().toLowerCase();
   const type    = String(row.type || '').trim().toLowerCase();
   const leisure = String(row.leisure || '').trim().toLowerCase();
   const natural = String(row.natural || '').trim().toLowerCase();
   const landuse = String(row.landuse || '').trim().toLowerCase();

  if (tourism === 'museum') return 'museums';
  if (tourism === 'attraction' || tourism === 'artwork' || type.includes('historic')) return 'sights';

  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurants';
  if (amenity === 'cafe' || amenity === 'ice_cream')       return 'cafes';
  if (amenity === 'bar' || amenity === 'pub')               return 'bars';

   // Parks / nature
   if (
     type === 'park' || amenity === 'park' ||
     leisure === 'park' || leisure === 'garden' ||
     natural === 'wood' || natural === 'grassland' ||
     landuse === 'forest'
   ) return 'parks';
  // pastane/fırın gibi shop türlerini "cafes" altında toplayalım
  if (shop === 'bakery' || shop === 'confectionery' || shop === 'pastry') return 'cafes';

  return 'sights';
}

/* --------------------------------------------------------------------------
 * CSV okuma: Metro + expo-asset ile güvenli okuma
 *  - CSV dosyasını asset olarak bundle ediyoruz.
 *  - Yol sapması olmasın diye birden çok göreli yolu deneriz.
 *  - İçerik boş/bozuksa ilk 160 karakterini loglayıp erken çıkarız.
 * -------------------------------------------------------------------------- */
const CSV_RESOLVERS = [
  // components/ → ../src
  () => require('../src/data/atlas-state/turkey_poi.csv'),
];

async function fastSearch({ city, cat, q }){
  const local = await queryPoi({ country:'TR', city, category:cat, q, limit:50 });
  if (local.rows.length) return local.rows.map(mapperLocal);

  // fallback server
  const remote = await poiSearch(q || cat, { city, lat: center.lat, lon: center.lng, category: cat });
  return (remote||[]).map(mapperRemote);
}

async function readCsvTextFromAsset() {
  let lastErr;
  for (const get of CSV_RESOLVERS) {
    try {
      const csvModule = get();
      const asset = Asset.fromModule(csvModule);
      await asset.downloadAsync(); // her durumda indir (Android için güvenli)
      const uri = asset.localUri || asset.uri;
      if (!uri) throw new Error('CSV asset URI boş');
      const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('CSV asset bulunamadı');
}

// CSV’yi yükle (province/cityName filtreli)
// TripListQuestion.js içindeki loadLocalCSVAsync fonksiyonunu bununla değiştir
async function loadLocalCSVAsync(cityName = '') {
  try {
    const text = await readCsvTextFromAsset();
    if (!text || typeof text !== 'string') {
      console.warn('[CSV] Boş içerik');
      return { items: [], counts: {} };
    }

    // 1) CSV'yi bir kerede parse et (header + skipEmptyLines)
    const parsed = Papa.parse(text, {
      header: true,
      delimiter: ',',
      skipEmptyLines: 'greedy',
      transformHeader: (h) => String(h || '').trim(),
      dynamicTyping: false, // RN ortamında CPU'yu az yıpratalım
    });

    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    console.log('[CSV] toplam satır:', rows.length, 'şehir filtresi:', cityName);

    // 2) UI'ı bloklamamak için batch işleme yardımcıları
    const BATCH = 600;
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const cityNorm = norm(cityName);
    const counts = { sights: 0, restaurants: 0, cafes: 0, bars: 0, museums: 0, parks: 0 };
    const items = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      for (let j = 0; j < slice.length; j++) {
        const row = slice[j];
          // şehir filtresi (province/city/town alanlarından)
        const prov = String(row.province || row.city || row.town || '').trim();
        if (cityNorm && norm(prov) !== cityNorm) continue;

        const name = pickField(row, ['name', 'title', 'poi_name'], '(isimsiz)');
        const lat  = toNumber(pickField(row, ['lat', 'latitude']));
        const lon  = toNumber(pickField(row, ['lon', 'lng', 'longitude']));
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const category = mapCsvRowCategory(row);
        counts[category] = (counts[category] || 0) + 1;

        const item = {
          id: String(row.id || row._id || `csv_${i + j}`),
          name,
          category,
          lat,
          lon,
          address: '',
          city: prov,
          place_id: undefined,
          source: 'local',
          // 🔎 aramayı hızlandırmak için normalize cache
          nameNorm: norm(name),
          addrNorm: '',
        };
        items.push(item);
      }
      // her batch sonunda event-loop'a bırak → UI donmasın
      await tick();
    }

    return { items, counts };
  } catch (e) {
    console.warn('CSV yüklenemedi →', e?.message || e);
    return { items: [], counts: {} };
  }
}


/**
 * Props:
 * - trip: { startDate, endDate, dailyPlan?, selectedPlaces? }
 * - setTrip(nextTrip)
 * - onBack?, onNext?
 * - cityName?: string
 * - cityCenter?: { lat, lng }
 */
export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  cityName = '',
  cityCenter = { lat: 39.92077, lng: 32.85411 },
}) {
  const [csvData, setCsvData] = useState([]);
  const [catCounts, setCatCounts] = useState({});
  const [loadingCsv, setLoadingCsv] = useState(true);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [remoteResults, setRemoteResults] = useState([]);

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);
useEffect(() => {
  let mounted = true;
  (async () => {
    setLoadingCsv(true);
    const { items, counts } = await loadLocalCSVAsync(cityName);
    if (!mounted) return;
    setCsvData(items);
    setCatCounts(counts || {});
    const firstWithData = CATEGORIES.find((c) => (counts?.[c.key] || 0) > 0);
    setActiveCat(firstWithData ? firstWithData.key : CATEGORIES[0].key);
    setLoadingCsv(false);
  })();
  return () => { mounted = false; };
}, [cityName]);
  // CSV’yi şehir filtresiyle yükle
useEffect(() => {
  let mounted = true;
  (async () => {
    const { items, counts } = await loadLocalCSVAsync(cityName);
    if (!mounted) return;
    setCsvData(items);
    setCatCounts(counts || {});

    // veri olan ilk kategoriye geç
    const firstWithData = CATEGORIES.find((c) => (counts?.[c.key] || 0) > 0);
    setActiveCat(firstWithData ? firstWithData.key : CATEGORIES[0].key);

    console.log('🔎 Kategori dağılımı:', counts);
    console.log('✅ Aktif Kategori:', firstWithData?.key || CATEGORIES[0].key);
  })();
  return () => { mounted = false; };
}, [cityName]);

  // Arama: önce yerel, yoksa Google
  const debRef = useRef(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);

    if (!query || query.trim().length < 2) {
      setRemoteResults([]);
      return;
    }

    const localMatches = filterLocal(csvData, query.trim(), activeCat);
    if (localMatches.length > 0) {
      setRemoteResults([]);
      return;
    }

    setLoading(true);
    debRef.current = setTimeout(async () => {
      try {
        const out = await poiSearch(query.trim(), {
          lat: cityCenter?.lat ?? 39.92,
          lon: cityCenter?.lng ?? 32.85,
          city: cityName || 'Ankara',
          category: catKeyToQuery(activeCat),
        });
        const mapped = (out || []).map((r, i) => ({
          id: String(r.place_id || `g_${i}`),
          name: r.name,
          category: activeCat,
          lat: r.lat,
          lon: r.lon,
          address: '',
          place_id: r.place_id,
          source: 'google',
        }));
        setRemoteResults(mapped);
      } catch (err) {
        console.warn('[poiSearch] hata:', err?.message || err);
        setRemoteResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [query, activeCat, cityCenter?.lat, cityCenter?.lng, cityName, csvData]);

  // Görüntülenecek 20’lik liste
  const visibleList = useMemo(() => {
    const q = (query || '').trim();
    const local = q.length >= 2
      ? filterLocal(csvData, q, activeCat)
      : sampleLocal(csvData, activeCat, 20);
    if (q.length >= 2 && local.length === 0 && remoteResults.length > 0) {
      return remoteResults.slice(0, 20);
    }
    return local.slice(0, 20);
  }, [csvData, query, activeCat, remoteResults]);

  function toggleSelection(item) {
    const exists = selected.find((x) => x.id === item.id);
    let next;
    if (exists) next = selected.filter((x) => x.id !== item.id);
    else next = [...selected, toPlace(item)];
    setTrip?.({ ...(trip || {}), selectedPlaces: next });
  }

  const selectedCount = selected.length;

  return (
    <View style={{ gap: 12 }}>
      {/* Kategori sekmeleri */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <View style={{ flexDirection: 'row' }}>
            {CATEGORIES.map((c) => {
            const active = c.key === activeCat;
            const count = catCounts?.[c.key] || 0;   // ⬅️ artık filter yok
            return (
                <Pressable
                key={c.key}
                onPressIn={() => console.log('TAB_PRESSIN', c.key)}
                onPress={() => setActiveCat(c.key)}
                style={[styles.tab, active && styles.tabActive]}
                >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {c.label}{count ? ` (${count})` : ''}
                </Text>
                </Pressable>
            );
            })}
        </View>
      </ScrollView>

      {/* Arama çubuğu */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color="#9AA0A6" />
        <TextInput
          placeholder="Ara: müze, kafe, park… (önce yerel veri, sonra Google)"
          placeholderTextColor="#6B7280"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {loading ? <ActivityIndicator /> : null}
      </View>

      {/* Sonuçlar */}
      <FlatList
  horizontal
  data={visibleList}
  keyExtractor={(it) => String(it.id)}
  removeClippedSubviews
  initialNumToRender={6}
  maxToRenderPerBatch={8}
  windowSize={5}
  updateCellsBatchingPeriod={50}
  keyboardShouldPersistTaps="handled"
  decelerationRate="fast"
  snapToAlignment="start"
  contentContainerStyle={{ paddingBottom: 8, paddingHorizontal: 4 }}
        renderItem={({ item }) => {
          const checked = !!selected.find((x) => x.id === item.id);
          return (
            <Pressable onPressIn={() => console.log('CARD_PRESSIN', item.id)} onPress={() => toggleSelection(item)} style={[styles.card, checked && styles.cardChecked]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={styles.checkbox}>{checked ? <Ionicons name="checkmark" size={16} color="#0D0F14" /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
                </View>
                <Badge>{item.source === 'google' ? 'Google' : 'Yerel'}</Badge>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={22} color="#9AA0A6" />
            <Text style={styles.emptyText}>Bu kategori için sonuç yok.</Text>
          </View>
        )
         : null}
      />

      {/* Alt bar */}
      <View style={styles.bottomBar}>
        <Text style={{ color: '#A8A8B3' }}>Seçili: <Text style={{ color: '#fff', fontWeight: '800' }}>{selectedCount}</Text></Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPressIn={() => console.log('BACK_PRESSIN')} onPress={onBack} disabled={!onBack} style={[styles.smallBtn, !onBack && { opacity: 0.5 }]}> 
            <Text style={{ color: '#fff', fontWeight: '700' }}>Geri</Text>
          </Pressable>
          <Pressable onPress={onNext} disabled={!onNext} style={[styles.primaryBtn, { paddingVertical: 10 }, !onNext && { opacity: 0.5 }]}> 
            <Text style={{ color: '#fff', fontWeight: '700' }}>İleri</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* --------------------------- helpers --------------------------- */
function catKeyToQuery(k) {
  if (k === 'restaurants') return 'restaurant';
  if (k === 'cafes') return 'cafe';
  if (k === 'bars') return 'bar';
  if (k === 'museums') return 'museum';
  if (k === 'parks') return 'park';
  return ''; // sights
}

function filterLocal(csvData, q, activeCat) {
  const qq = norm(q);
  return csvData.filter(
    (x) => x.category === activeCat && (x.nameNorm.includes(qq) || x.addrNorm.includes(qq))
  );
}


function sampleLocal(csvData, activeCat, n = 20) {
  const arr = csvData.filter((x) => x.category === activeCat);
  if (arr.length <= n) return arr;
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function toPlace(item) {
  return {
    id: String(item.id),
    name: item.name,
    coords: Number.isFinite(item.lat) && Number.isFinite(item.lon) ? { lat: item.lat, lng: item.lon } : undefined,
    address: item.address || undefined,
    source: item.source,
    place_id: item.place_id,
    category: item.category,
    addedAt: new Date().toISOString(),
  };
}

/* ---------------------------- UI bits ---------------------------- */
function Badge({ children }) {
  return (
    <View style={styles.badge}>
      <Text style={{ color: '#0D0F14', fontWeight: '800', fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/* ----------------------------- styles ---------------------------- */
const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 4, gap: 8 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER,
    borderRadius: 999, backgroundColor: '#0D0F14', marginRight: 8,
  },
  tabActive: { borderColor: BTN, backgroundColor: '#111827' },
  tabText: { color: '#9AA0A6', fontWeight: '700' },
  tabTextActive: { color: '#fff' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#0D0F14' },
  searchInput: { flex: 1, color: '#fff' },

  card: {
    width: 240,
    marginRight: 10,
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    padding: 12, backgroundColor: '#0B0D12',
  },
  cardChecked: { borderColor: BTN, backgroundColor: '#0F1420' },
  rowChecked: { borderColor: BTN, backgroundColor: '#0F1420' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: BTN, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0F14' },

  name: { color: '#fff', fontWeight: '700' },
  addr: { color: '#9AA0A6', fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyText: { color: '#9AA0A6' },

  bottomBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: BORDER, paddingTop: 10 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },
  primaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: BTN },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#60A5FA' },
});
