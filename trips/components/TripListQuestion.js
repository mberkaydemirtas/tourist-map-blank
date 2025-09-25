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
      .trim();
  } catch {
    return str.toLowerCase();
  }
};
const norm = (s) => safeNormalize(s);

/* --------------------------- helpers --------------------------- */
function catKeyToQuery(k) {
  if (k === 'restaurants') return 'restaurant';
  if (k === 'cafes') return 'cafe';
  if (k === 'bars') return 'bar';
  if (k === 'museums') return 'museum';
  if (k === 'parks') return 'park';
  return ''; // sights
}

function toPlace(item) {
  return {
    id: String(item.id),
    name: item.name,
    coords:
      Number.isFinite(item.lat) && Number.isFinite(item.lon)
        ? { lat: item.lat, lng: item.lon }
        : undefined,
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

/* ========================= BİLEŞEN ========================= */
export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  countryCode = trip?.countryCode || 'TR',
  cityName    = trip?.cityName    || '',
  cityCenter  = trip?.cityCenter  || { lat: 39.92077, lng: 32.85411 },
}) {
  const [items, setItems] = useState([]);         // aktif liste (lokal/remote karışık)
  const [catCounts, setCatCounts] = useState({}); // kategori sayaçları (lokal DB)
  const [loading, setLoading] = useState(false);  // arama/list yükleniyor mu
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);

  // 1) DB’yi ısıt + kategori sayaçlarını çek
  console.log('[TripList] init load → cityName:', cityName, 'category:', activeCat);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await prewarmPoiShard(countryCode);
        const counts = await getCategoryCounts({ country: countryCode, city: cityName });
        if (!mounted) return;
        setCatCounts(counts || {});
        // veri olan ilk kategoriye geç
        const firstWithData = CATEGORIES.find((c) => (counts?.[c.key] || 0) > 0);
        setActiveCat(firstWithData ? firstWithData.key : CATEGORIES[0].key);
      } catch (e) {
        console.warn('[TripList] prewarm/getCategoryCounts error:', e?.message || e);
        if (mounted) setCatCounts({});
      }
    })();
    return () => {
      mounted = false;
    };
  }, [countryCode, cityName]);

  // 2) Aktif kategori/şehir değişince, q yokken kısa liste (lokal 20 kayıt)
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const out = await searchPoiHybrid({
          country: countryCode,
          city: cityName,
          category: activeCat,
          q: '', // q yok → lokal öncelikli
          limit: 20,
          center: cityCenter,
        });
        if (!mounted) return;
        setItems(out || []);
      } catch (e) {
        if (__DEV__) console.warn('[TripList] initial fetch error:', e?.message || e);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeCat, cityName, cityCenter?.lat, cityCenter?.lng]);

  // 3) Arama (debounce) — önce lokal, boşsa remote (poiHybrid içinde fallback)
  
  const debRef = useRef(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const q = (query || '').trim();
    console.log('[TripList] search → q:', q, 'cat:', activeCat, 'city:', cityName);
    // q < 2 → tekrar kısa liste
    if (q.length < 2) {
      debRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const out = await searchPoiHybrid({
            country: 'TR',
            city: cityName,
            category: activeCat,
            q: '',
            limit: 20,
            center: cityCenter,
          });
          setItems(out || []);
        } catch {
          setItems([]);
        } finally {
          setLoading(false);
        }
      }, 120);
      return () => debRef.current && clearTimeout(debRef.current);
    }

    // q >= 2 → hibrit arama
    setLoading(true);
    debRef.current = setTimeout(async () => {
      try {
        const out = await searchPoiHybrid({
          country: 'TR',
          city: cityName,
          category: activeCat,
          q,
          limit: 50,
          center: cityCenter,
        });
        setItems(out || []);
      } catch (err) {
        console.warn('[TripList] search error:', err?.message || err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [query, activeCat, cityName, cityCenter?.lat, cityCenter?.lng]);

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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        <View style={{ flexDirection: 'row' }}>
          {CATEGORIES.map((c) => {
            const active = c.key === activeCat;
            const count = catCounts?.[c.key] || 0;
            return (
              <Pressable
                key={c.key}
                onPressIn={() => console.log('TAB_PRESSIN', c.key)}
                onPress={() => setActiveCat(c.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {c.label}
                  {count ? ` (${count})` : ''}
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
          placeholder="Ara: müze, kafe, park… (önce lokal, yoksa Google)"
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
        vertical
        scrollEnabled
        data={items}
        keyExtractor={(it) => String(it.id)}
        removeClippedSubviews
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        keyboardShouldPersistTaps="handled"
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={{ paddingBottom: 12, paddingVertical: 4 }}
        renderItem={({ item }) => {
          const checked = !!selected.find((x) => x.id === item.id);
          return (
            <Pressable
              onPressIn={() => console.log('CARD_PRESSIN', item.id)}
              onPress={() => toggleSelection(item)}
              style={[styles.card, checked && styles.cardChecked]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={styles.checkbox}>
                  {checked ? <Ionicons name="checkmark" size={16} color="#0D0F14" /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {!!item.address && (
                    <Text style={styles.addr} numberOfLines={1}>
                      {item.address}
                    </Text>
                  )}
                </View>
                <Badge>{item.source === 'google' ? 'Google' : 'Yerel'}</Badge>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={22} color="#9AA0A6" />
              <Text style={styles.emptyText}>Bu kategori için sonuç yok.</Text>
            </View>
          ) : null
        }
      />

      {/* Alt bar */}
      <View style={styles.bottomBar}>
        <Text style={{ color: '#A8A8B3' }}>
          Seçili: <Text style={{ color: '#fff', fontWeight: '800' }}>{selectedCount}</Text>
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPressIn={() => console.log('BACK_PRESSIN')}
            onPress={onBack}
            disabled={!onBack}
            style={[styles.smallBtn, !onBack && { opacity: 0.5 }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Geri</Text>
          </Pressable>
          <Pressable
            onPress={onNext}
            disabled={!onNext}
            style={[styles.primaryBtn, { paddingVertical: 10 }, !onNext && { opacity: 0.5 }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>İleri</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ----------------------------- styles ---------------------------- */
const styles = StyleSheet.create({
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
    width: 240,
    marginRight: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0B0D12',
  },
  cardChecked: { borderColor: BTN, backgroundColor: '#0F1420' },
  rowChecked: { borderColor: BTN, backgroundColor: '#0F1420' },
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

  name: { color: '#fff', fontWeight: '700' },
  addr: { color: '#9AA0A6', fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyText: { color: '#9AA0A6' },

  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: BORDER,
    paddingTop: 10,
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#0D0F14',
  },
  primaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: BTN },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#60A5FA' },
});
