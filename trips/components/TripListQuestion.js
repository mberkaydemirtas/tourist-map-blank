// trips/components/TripListQuestion.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  prewarmPoiShard,
  getCategoryCounts,
  searchPoiGoogleOnly, // sadece Google Autocomplete
} from '../../app/lib/poiHybrid';
import { newPlacesSessionToken } from '../../app/lib/api.js';

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

// performans ayarları
const MIN_CHARS   = 3;   // en az 3 harf
const DEBOUNCE_MS = 300; // 300 ms bekleme

/* --------------------------- helpers --------------------------- */
function toPlace(item, fallbackCity) {
  return {
    id: String(item.id ?? item.place_id ?? Math.random().toString(36).slice(2)),
    name: item.name,
    coords:
      Number.isFinite(item.lat) && Number.isFinite(item.lon)
        ? { lat: item.lat, lng: item.lon }
        : undefined,
    address: item.address || undefined,
    source: item.source,
    place_id: item.place_id,
    category: item.category,
    city: item.city || fallbackCity || '',
    addedAt: new Date().toISOString(),
  };
}

function Badge({ children }) {
  return (
    <View style={styles.badge}>
      <Text style={{ color: '#0D0F14', fontWeight: '800', fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/* ========================= BİLEŞEN ========================= */
export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  countryCode = trip?.countryCode || 'TR',
  cityName    = trip?.cityName    || '',
  cityCenter  = trip?.cityCenter  || { lat: 39.92077, lng: 32.85411 },

  listHeight = 420,
  selectedListHeight = 220,
}) {
  const [items, setItems] = useState([]);         // sadece Google autocomplete sonuçları
  const [catCounts, setCatCounts] = useState({}); // kategori sayaçları (lokal DB)
  const [loading, setLoading] = useState(false);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState('');
  const reqIdRef = useRef(0);                     // latest-only kimliği
  const debRef = useRef(null);

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);
  const selectedCityItems = useMemo(
    () => (selected || []).filter((x) => (x.city || '') === (cityName || '')),
    [selected, cityName]
  );

  // Autocomplete session token (Google maliyeti optimizasyonu)
  const sessionRef = useRef(null);
  useEffect(() => {
    const qTrim = (query || '').trim();
    if (qTrim && !sessionRef.current) sessionRef.current = newPlacesSessionToken();
    if (!qTrim) sessionRef.current = null; // arama temizlenince yeni seans
  }, [query]);

  // 1) DB'yi ısıt + kategori sayaçlarını çek (listeyi lokalden doldurmuyoruz)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await prewarmPoiShard(countryCode);
        const counts = await getCategoryCounts({ country: countryCode, city: cityName });
        if (!mounted) return;
        setCatCounts(counts || {});
        const firstWithData = CATEGORIES.find((c) => (counts?.[c.key] || 0) > 0);
        setActiveCat(firstWithData ? firstWithData.key : CATEGORIES[0].key);
      } catch (e) {
        console.warn('[TripList] prewarm/getCategoryCounts error:', e?.message || e);
        if (mounted) setCatCounts({});
      }
    })();
    return () => { mounted = false; };
  }, [countryCode, cityName]);

  // 2) Kategori/şehir değişince başlangıç listesi boş
  useEffect(() => { setItems([]); }, [activeCat, cityName, cityCenter?.lat, cityCenter?.lng, countryCode]);

  // 3) Arama: yalnızca Google Autocomplete (min 3 harf + debounce + latest-only)
  useEffect(() => {
    let mounted = true;
    if (debRef.current) clearTimeout(debRef.current);
    const qTrim = (query || '').trim();

    // 3 harften az ise istek yok, anında boş liste
    if (!qTrim || qTrim.length < MIN_CHARS) {
      setItems([]);
      setLoading(false);
      return;
    }

    debRef.current = setTimeout(async () => {
      if (!mounted) return;
      const myReqId = ++reqIdRef.current;
      setLoading(true);
      try {
        const out = await searchPoiGoogleOnly({
          city: cityName,
          category: activeCat,
          q: qTrim,
          limit: 50,
          center: cityCenter,
          sessionToken: sessionRef.current,
        });
        if (!mounted || myReqId !== reqIdRef.current) return; // stale cevap
        setItems(out || []);
        if (__DEV__) console.log('[TripList] google-only len=', out?.length || 0, 'q=', qTrim);
      } catch (e) {
        if (__DEV__) console.warn('[TripList] google-only error:', e?.message || e);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      mounted = false;
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [query, activeCat, cityName, cityCenter?.lat, cityCenter?.lng, countryCode]);

  function toggleSelection(item) {
    const cityKey = item.city || cityName; // aktif şehir fallback
    const exists = selected.find((x) => x.id === item.id && (x.city || '') === cityKey);
    let next;
    if (exists) next = selected.filter((x) => !(x.id === item.id && (x.city || '') === cityKey));
    else next = [...selected, toPlace(item, cityName)];
    setTrip?.({ ...(trip || {}), selectedPlaces: next });
  }

  const selectedCityCount = selectedCityItems.length;

  return (
    <View style={styles.container}>
      {/* Kategori sekmeleri (sayaçlar lokal DB’den) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        keyboardShouldPersistTaps="always"
      >
        <View style={{ flexDirection: 'row' }}>
          {CATEGORIES.map((c) => {
            const active = c.key === activeCat;
            const count = catCounts?.[c.key] || 0;
            return (
              <Pressable
                key={c.key}
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
          placeholder={`Google’dan ara (en az ${MIN_CHARS} harf)…`}
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
      <View style={{ height: listHeight }}>
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          extraData={selected}
          nestedScrollEnabled
          scrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingBottom: 12, paddingVertical: 4 }}
          getItemLayout={getItemLayout}
          renderItem={({ item }) => {
            const cityKey = item.city || cityName;
            const checked = !!selected.find((x) => x.id === item.id && (x.city || '') === cityKey);
            return (
              <Pressable
                onPress={() => toggleSelection(item)}
                style={[styles.card, checked && styles.cardChecked]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#0D0F14" /> : null}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                    {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Badge>{item.source === 'google' ? 'Google' : 'Yerel'}</Badge>
                    {checked ? <Text style={styles.selectedPill}>Seçili</Text> : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={22} color="#9AA0A6" />
                <Text style={styles.emptyText}>En az {MIN_CHARS} harf yazın.</Text>
              </View>
            ) : null
          }
        />
      </View>

      {/* Seçili yerler */}
      <View style={{ height: 12 }} />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Seçilenler {cityName ? `(${cityName})` : ''}</Text>
        <Text style={styles.sectionCount}>{selectedCityCount}</Text>
      </View>
      <View style={styles.selectedListWrapper(selectedListHeight)}>
        <FlatList
          data={selectedCityItems}
          keyExtractor={(it, idx) => (it?.id && String(it.id)) || (it?.place_id && `pid-${it.place_id}`) || `sel-${idx}`}
          nestedScrollEnabled
          scrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingBottom: 12, paddingVertical: 4 }}
          getItemLayout={getItemLayout}
          renderItem={({ item }) => (
            <Pressable onPress={() => toggleSelection(item)} style={[styles.card, styles.cardSelectedList]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={[styles.checkbox, styles.checkboxChecked]}>
                  <Ionicons name="checkmark" size={16} color="#0D0F14" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}{item.source === 'google' ? ' · Google' : ''}
                  </Text>
                  {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
                </View>
                <Text style={styles.removeText}>Kaldır</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.emptyMini}>
              <Text style={styles.emptyText}>Henüz seçim yapılmadı.</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

/* ----------------------------- helpers (list) ---------------------------- */
function keyExtractor(it, idx) {
  return (it?.id && String(it.id)) || (it?.place_id && `pid-${it.place_id}`) || `row-${idx}`;
}
function getItemLayout(_, index) {
  return { length: 72, offset: 72 * index, index };
}

/* ----------------------------- styles ---------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { paddingHorizontal: 4, gap: 8 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    backgroundColor: '#0D0F14',
    marginRight: 8,
  },
  tabActive: { borderColor: BTN, backgroundColor: '#111827' },
  tabText: { color: '#9AA0A6', fontWeight: '700' },
  tabTextActive: { color: '#fff' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0D0F14',
  },
  searchInput: { flex: 1, color: '#fff' },

  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0B0D12',
    marginBottom: 10,
  },
  cardChecked: { borderColor: BTN, backgroundColor: '#0F1420' },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: BTN,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0F14',
  },
  checkboxChecked: {
    backgroundColor: BTN,
    borderColor: BTN,
  },

  name: { color: '#fff', fontWeight: '700' },
  addr: { color: '#9AA0A6', fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyMini: { alignItems: 'center', paddingVertical: 10 },
  emptyText: { color: '#9AA0A6' },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#60A5FA' },

  selectedPill: {
    color: '#C7D2FE',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
    overflow: 'hidden',
  },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: '#E5E7EB', fontWeight: '800' },
  sectionCount: { color: '#9AA0A6', fontWeight: '700' },

  cardSelectedList: { backgroundColor: '#0F1420' },
  removeText: { color: '#FCA5A5', fontWeight: '700' },

  selectedListWrapper: (h) => ({ height: h }),
});
