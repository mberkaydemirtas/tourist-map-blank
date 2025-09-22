// trips/components/TripListQuestion.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import Papa from 'papaparse';
import { poiSearch } from '../../app/lib/api';

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

// ---- Güvenli normalizasyon (Android JSC uyumlu)
const hasNormalize = typeof String.prototype.normalize === 'function';
const safeNormalize = (s) => {
  const str = String(s || '');
  if (!hasNormalize) return str.toLowerCase();
  try {
    return str.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  } catch {
    // Bazı edge cihazlarda normalize runtime’da hata verebiliyor
    return str.toLowerCase();
  }
};
const norm = (s) => safeNormalize(s);

function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

// CSV satırından olası kolon adlarına bakarak alan seç
function pickField(row, candidates, def = '') {
  for (const c of candidates) {
    if (row[c] != null && String(row[c]).trim() !== '') return row[c];
  }
  return def;
}

// --- CSV kategori eşleme (amenity / shop / tourism / type -> app kategorisi)
function mapCsvRowCategory(row) {
  const amenity = String(row.amenity || '').toLowerCase();
  const tourism = String(row.tourism || '').toLowerCase();
  const shop    = String(row.shop || '').toLowerCase();
  const type    = String(row.type || '').toLowerCase();

  if (tourism === 'museum') return 'museums';
  if (tourism === 'attraction' || tourism === 'artwork' || type.includes('historic')) return 'sights';

  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurants';
  if (amenity === 'cafe' || amenity === 'ice_cream')       return 'cafes';
  if (amenity === 'bar' || amenity === 'pub')               return 'bars';

  if (type === 'park' || amenity === 'park') return 'parks';

  // pastane/fırın gibi shop türlerini "cafes" altında toplayalım
  if (shop === 'bakery' || shop === 'confectionery' || shop === 'pastry') return 'cafes';

  return 'sights';
}

// CSV’yi yükle (province/cityName filtreli)
async function loadLocalCSVAsync(cityName = '') {
  try {
    // Bu dosya konumu: trips/components → ../src/data/atlas-state/turkey_poi.csv
    const csvModule = require('../src/data/atlas-state/turkey_poi.csv');
    const asset = Asset.fromModule(csvModule);

    if (!asset.downloaded) {
      await asset.downloadAsync();
    }
    const uri = asset.localUri || asset.uri;
    if (!uri) {
      console.warn('CSV yüklenemedi: asset URI yok');
      return [];
    }

    const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    if (!text || typeof text !== 'string') {
      console.warn('CSV yüklenemedi: metin boş');
      return [];
    }

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = Array.isArray(parsed.data) ? parsed.data : [];

    const cityNorm = norm(cityName);
    const items = rows
      .filter(r => {
        if (!cityNorm) return true;
        const prov = String(r.province || r.city || r.town || '').trim();
        return norm(prov) === cityNorm; // örn: "Adana" → sadece Adana
      })
      .map((row, i) => {
        const name = pickField(row, ['name', 'title', 'poi_name'], '(isimsiz)');
        const lat  = toNumber(pickField(row, ['lat', 'latitude']));
        const lon  = toNumber(pickField(row, ['lon', 'lng', 'longitude']));
        const city = pickField(row, ['province', 'city', 'town'], '');

        const category = mapCsvRowCategory(row);

        return {
          id: String(row.id || row._id || `csv_${i}`),
          name,
          category,
          lat,
          lon,
          address: '', // CSV’de yoksa boş
          city,
          place_id: undefined,
          source: 'local',
        };
      })
      .filter(x => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon));

    return items;
  } catch (e) {
    console.warn('CSV yüklenemedi:', e?.message || e);
    return [];
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
  cityName = 'Ankara',
  cityCenter = { lat: 39.92077, lng: 32.85411 },
}) {
  const [csvData, setCsvData] = useState([]);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [remoteResults, setRemoteResults] = useState([]);

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);

  // CSV’yi şehir filtresiyle yükle
  useEffect(() => {
    let mounted = true;
    loadLocalCSVAsync(cityName).then(items => { if (mounted) setCsvData(items); });
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
      } catch {
        setRemoteResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, activeCat, cityCenter?.lat, cityCenter?.lng, cityName, csvData]);

  // Görüntülenecek 20’lik liste
  const visibleList = useMemo(() => {
    const base = (query && query.trim().length >= 2)
      ? filterLocal(csvData, query.trim(), activeCat).slice(0, 20)
      : sampleLocal(csvData, activeCat, 20);

    if (query && query.trim().length >= 2 && base.length === 0 && remoteResults.length > 0) {
      return remoteResults.slice(0, 20);
    }
    return base;
  }, [csvData, query, activeCat, remoteResults]);

  function toggleSelection(item) {
    const exists = selected.find(x => x.id === item.id);
    let next;
    if (exists) next = selected.filter(x => x.id !== item.id);
    else next = [...selected, toPlace(item)];
    setTrip?.({ ...(trip || {}), selectedPlaces: next });
  }

  const selectedCount = selected.length;

  return (
    <View style={{ gap: 12 }}>
      {/* Kategori sekmeleri */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {CATEGORIES.map(c => {
          const active = c.key === activeCat;
          return (
            <Pressable key={c.key} onPress={() => setActiveCat(c.key)} style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
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
        data={visibleList}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => {
          const checked = !!selected.find(x => x.id === item.id);
          return (
            <Pressable onPress={() => toggleSelection(item)} style={[styles.row, checked && styles.rowChecked]}>
              <View style={styles.checkbox}>{checked ? <Ionicons name="checkmark" size={16} color="#0D0F14" /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
              </View>
              <Badge>{item.source === 'google' ? 'Google' : 'Yerel'}</Badge>
            </Pressable>
          );
        }}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={22} color="#9AA0A6" />
            <Text style={styles.emptyText}>Bu kategori için sonuç yok.</Text>
          </View>
        ) : null}
        contentContainerStyle={{ paddingBottom: 8 }}
      />

      {/* Alt bar */}
      <View style={styles.bottomBar}>
        <Text style={{ color: '#A8A8B3' }}>Seçili: <Text style={{ color: '#fff', fontWeight: '800' }}>{selectedCount}</Text></Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {onBack ? (
            <Pressable onPress={onBack} style={styles.smallBtn}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Geri</Text>
            </Pressable>
          ) : null}
          {onNext ? (
            <Pressable onPress={onNext} style={[styles.primaryBtn, { paddingVertical: 10 }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>İleri</Text>
            </Pressable>
          ) : null}
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
  return csvData.filter(x =>
    x.category === activeCat &&
    (norm(x.name).includes(qq) || norm(x.address).includes(qq))
  );
}

function sampleLocal(csvData, activeCat, n = 20) {
  const arr = csvData.filter(x => x.category === activeCat);
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
    coords: (Number.isFinite(item.lat) && Number.isFinite(item.lon)) ? { lat: item.lat, lng: item.lon } : undefined,
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

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 10, backgroundColor: '#0B0D12', marginBottom: 8 },
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
