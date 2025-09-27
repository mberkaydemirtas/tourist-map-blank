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
  ScrollView, // yatay sekmeler için güvenli
} from 'react-native';
import { FlatList as GHFlatList } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  prewarmPoiShard,
  getCategoryCounts,
  searchPoiLocal,
  searchPoiHybridThreshold,
} from '../../app/lib/poiHybrid';
import { newPlacesSessionToken } from '../../app/lib/api.js';

const CATEGORIES = [
  { key: 'sights',      label: 'Turistik Yerler' },
  { key: 'restaurants', label: 'Restoranlar' },
  { key: 'cafes',       label: 'Kafeler' },
  { key: 'bars',        label: 'Barlar' },
  { key: 'museums',     label: 'Müzeler' },
  { key: 'parks',       label: 'Parklar' },
];
const CAT_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));
const labelForCat = (k) => CAT_LABELS[k] || k || '';

const BTN = '#2563EB';
const BORDER = '#23262F';
const MIN_CHARS = 1;
const DEBOUNCE_MS = 250;

/* helpers */
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

export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  countryCode = trip?.countryCode || 'TR',
  cityName    = trip?.cityName    || '',
  cityCenter  = trip?.cityCenter  || { lat: 39.92077, lng: 32.85411 },

  // dış sayfa scroll’undan bağımsız, bu kartın içinde scroll edilecek yükseklik
  placesMaxHeight = 360,
}) {
  const [items, setItems] = useState([]);
  const [catCounts, setCatCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState('');
  const reqIdRef = useRef(0);
  const debRef = useRef(null);
  const initialLocalRef = useRef([]);

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);
  const selectedCityItems = useMemo(
    () => (selected || []).filter((x) => (x.city || '') === (cityName || '')),
    [selected, cityName]
  );

  // Google session token
  const sessionRef = useRef(null);
  useEffect(() => {
    const qTrim = (query || '').trim();
    if (qTrim && !sessionRef.current) sessionRef.current = newPlacesSessionToken();
    if (!qTrim) sessionRef.current = null;
  }, [query]);

  // prewarm + sayaçlar
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
      } catch {
        if (mounted) setCatCounts({});
      }
    })();
    return () => { mounted = false; };
  }, [countryCode, cityName]);

  // preload local
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const out = await searchPoiLocal({
          country: countryCode,
          city: cityName,
          category: activeCat,
          q: '',
          limit: 20,
        });
        if (!mounted) return;
        initialLocalRef.current = out || [];
        setItems(initialLocalRef.current);
      } catch {
        if (mounted) {
          initialLocalRef.current = [];
          setItems([]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [activeCat, cityName, countryCode]);

  // arama (local → gerekirse google)
  useEffect(() => {
    let mounted = true;
    if (debRef.current) clearTimeout(debRef.current);
    const qTrim = (query || '').trim();

    if (!qTrim || qTrim.length < MIN_CHARS) {
      setItems(initialLocalRef.current);
      setLoading(false);
      return;
    }

    debRef.current = setTimeout(async () => {
      if (!mounted) return;
      const myReqId = ++reqIdRef.current;
      setLoading(true);
      try {
        const out = await searchPoiHybridThreshold({
          country: countryCode,
          city: cityName,
          category: activeCat,
          q: qTrim,
          limit: 50,
          center: cityCenter,
          minLocal: 3,
          sessionToken: sessionRef.current,
        });
        if (!mounted || myReqId !== reqIdRef.current) return;
        setItems(out || []);
      } catch {
        if (mounted) setItems(initialLocalRef.current);
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
    const cityKey = item.city || cityName;
    const exists = selected.find((x) => x.id === item.id && (x.city || '') === cityKey);
    let next;
    if (exists) next = selected.filter((x) => !(x.id === item.id && (x.city || '') === cityKey));
    else next = [...selected, toPlace(item, cityName)];
    setTrip?.({ ...(trip || {}), selectedPlaces: next });
  }

  const selectedCityCount = selectedCityItems.length;

  /* ---------------- render ---------------- */
  return (
    <View style={styles.root}>
      {/* Sekmeler — yatay scroll + hafif sola */}
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

      {/* Arama */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color="#9AA0A6" />
        <TextInput
          placeholder="Ara (önce veritabanı; azsa Google)…"
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

      {/* Places: kart içinde bağımsız scroll (GH FlatList) */}
      <View style={[styles.sheetDark, { maxHeight: placesMaxHeight }]}>
        <GHFlatList
          data={items}
          keyExtractor={keyExtractor}
          extraData={selected}
          nestedScrollEnabled
          scrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          overScrollMode="always"
          contentContainerStyle={styles.listContent}
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
                   {!!item.address && item.source !== 'google' && (
                     <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>
                   )}                  
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
                <Text style={styles.emptyText}>Sonuç yok.</Text>
              </View>
            ) : null
          }
        />
      </View>

      {/* Seçilenler — dış sayfayla birlikte kayar (iç scroll kapalı) */}
      <View style={{ height: 12 }} />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Seçilenler {cityName ? `(${cityName})` : ''}</Text>
        <Text style={styles.sectionCount}>{selectedCityCount}</Text>
      </View>

      <View style={[styles.sheetDark, { paddingVertical: 8 }]}>
        <FlatList
          data={selectedCityItems}
          keyExtractor={(it, idx) =>
            (it?.id && String(it.id)) || (it?.place_id && `pid-${it.place_id}`) || `sel-${idx}`
          }
          // Seçilenler ana sayfayla kayacak → iç scroll kapalı:
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { paddingBottom: 6 }]}
          renderItem={({ item }) => (
            <Pressable onPress={() => toggleSelection(item)} style={[styles.card, styles.cardSelectedList]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={[styles.checkbox, styles.checkboxChecked]}>
                  <Ionicons name="checkmark" size={16} color="#0D0F14" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.name} numberOfLines={2}>
                      {item.name}{item.source === 'google' ? ' · Google' : ''}
                    </Text>
                    {!!item.category && (
                      <Text style={styles.catTag} numberOfLines={1}>
                        {labelForCat(item.category)}
                      </Text>
                    )}
                  </View>
                   {!!item.address && item.source !== 'google' && (
                     <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>
                   )}                
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

/* list helpers */
function keyExtractor(it, idx) {
  return (it?.id && String(it.id)) || (it?.place_id && `pid-${it.place_id}`) || `row-${idx}`;
}

/* styles */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },

  // Sekmeleri az sola kaydır
  tabs: { paddingHorizontal: 8, gap: 8, marginLeft: -4, paddingRight: 6 },
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
    marginTop: 8,
  },
  searchInput: { flex: 1, color: '#fff' },

  // Kart benzeri kutu
  sheetDark: {
    backgroundColor: '#14161c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2d36',
    overflow: 'hidden',
    marginTop: 12,
  },
  listContent: { paddingHorizontal: 10, paddingVertical: 8, paddingBottom: 12 },

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
  checkboxChecked: { backgroundColor: BTN, borderColor: BTN },

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

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: { color: '#E5E7EB', fontWeight: '800' },
  sectionCount: { color: '#9AA0A6', fontWeight: '700' },

  // Seçilenler: kategori etiketi (yalnızca bu listede)
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  catTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D0F14',
    backgroundColor: '#60A5FA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  cardSelectedList: { backgroundColor: '#0F1420' },
  removeText: { color: '#FCA5A5', fontWeight: '700' },
});
