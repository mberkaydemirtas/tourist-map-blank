// trips/screens/TripListQuestion.js
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
import { FlatList as GHFlatList } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  prewarmPoiShard,
  getCategoryCounts,
  searchPoiLocal,
  addUserPoi,
} from '../../app/lib/poiHybrid.js';
import {
  newPlacesSessionToken,
  poiMatch,
  searchUnified, // ⬅️ tek giriş noktası (keystroke vs submit)
} from '../../app/lib/api.js';

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
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/* helpers */
const round5 = (x) => Math.round(Number(x) * 1e5) / 1e5;

function toPlace(item, fallbackCity, fallbackCategory) {
  const lat = Number.isFinite(item.lat) ? item.lat : Number(item.coords?.lat);
  const lon = Number.isFinite(item.lon) ? item.lon : Number(item.coords?.lng ?? item.coords?.lon);
  return {
    id: item.place_id ? `pid-${item.place_id}`
       : String(item.id ?? Math.random().toString(36).slice(2)),
    name: item.name,
    coords: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon } : undefined,
    address: item.address || undefined,
    source: item.source,
    place_id: item.place_id,
    category: item.category || fallbackCategory || 'sights',
    city: item.city || fallbackCity || '',
    addedAt: new Date().toISOString(),
  };
}

function Badge({ children, tone = 'blue' }) {
  const bg = tone === 'green' ? '#34D399' : tone === 'indigo' ? '#818CF8' : '#60A5FA';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} >
      <Text style={{ color: '#0D0F14', fontWeight: '800', fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/** Oturum içinde aynı place_id’yi gereksiz yere tekrar yazmamak için */
const seenPersistIds = new Set();

/** Sessiz persist (Google/suggest öğeleri → poi_user overlay) */
async function persistGoogleResultsSilently(list, { city, category }) {
  try {
    const jobs = [];
    const cap = 10;
    let pushed = 0;
    for (const it of list) {
      if (pushed >= cap) break;
      if (!(it?.source === 'google')) continue;
      const pid = it?.place_id;
      if (!pid || seenPersistIds.has(pid)) continue;

      const lat = Number.isFinite(it?.lat) ? it.lat : Number(it?.coords?.lat);
      const lon = Number.isFinite(it?.lon) ? it.lon : Number(it?.coords?.lng ?? it?.coords?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      jobs.push(
        addUserPoi({
          city,
          category: it?.category || category || 'sights',
          name: it?.name || '—',
          lat,
          lon,
          address: it?.address || '',
          place_id: pid,
        }).catch(() => {})
      );
      seenPersistIds.add(pid);
      pushed++;
    }
    if (jobs.length) await Promise.allSettled(jobs);
  } catch {}
}

/** Server match cache’inden batch eşleşme bilgisi çek ve öğelere işle */
async function annotateMatches(items, cityName) {
  try {
    const payload = items.map((x) => {
      const lat = Number.isFinite(x?.lat) ? x.lat : Number(x?.coords?.lat);
      const lon = Number.isFinite(x?.lon) ? x.lon : Number(x?.coords?.lng ?? x?.coords?.lon);
      return (x?.name && Number.isFinite(lat) && Number.isFinite(lon))
        ? { name: String(x.name), lat, lon, city: cityName || '' }
        : null;
    }).filter(Boolean);

    if (!payload.length) return items;

    const res = await poiMatch(payload, cityName).catch(() => null);
    const results = Array.isArray(res?.results) ? res.results : [];

    let idx = -1;
    const withFlags = items.map((it) => {
      const lat = Number.isFinite(it?.lat) ? it.lat : Number(it?.coords?.lat);
      const lon = Number.isFinite(it?.lon) ? it.lon : Number(it?.coords?.lng ?? it?.coords?.lon);
      if (!(it?.name && Number.isFinite(lat) && Number.isFinite(lon))) {
        return { ...it, matched: !!it?.place_id };
      }
      idx += 1;
      const r = results[idx];
      if (r?.matched && r?.place_id) {
        return {
          ...it,
          matched: true,
          place_id: it.place_id || r.place_id,
          rating: it.rating ?? r.rating ?? null,
          opening_hours: it.opening_hours ?? r.opening_hours ?? null,
        };
      }
      return { ...it, matched: !!it?.place_id };
    });

    // matched → google → local sırala
    withFlags.sort((a, b) => {
      const ma = a.matched ? 1 : 0;
      const mb = b.matched ? 1 : 0;
      if (mb !== ma) return mb - ma;
      const sa = a.source === 'google' ? 1 : 0;
      const sb = b.source === 'google' ? 1 : 0;
      return sb - sa;
    });

    return withFlags;
  } catch {
    return items;
  }
}

/** Aynı place_id / aynı (lat,lng,name) tekrarlarını ayıkla */
function dedupPlaces(arr) {
  const seenPid = new Set();
  const seenGeo = new Set();
  const out = [];
  for (const it of (arr || [])) {
    const pid = it?.place_id && String(it.place_id);
    if (pid) {
      if (seenPid.has(pid)) continue;
      seenPid.add(pid);
    } else {
      const la = Number(it?.lat ?? it?.coords?.lat);
      const lo = Number(it?.lon ?? it?.coords?.lng ?? it?.coords?.lon);
      const nm = (it?.name || '').toLowerCase();
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        const k = `${round5(la)},${round5(lo)}:${nm}`;
        if (seenGeo.has(k)) continue;
        seenGeo.add(k);
      }
    }
    out.push(it);
  }
  return out;
}

export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  countryCode = trip?.countryCode || 'TR',
  cityName    = trip?.cityName    || '',
  cityCenter  = trip?.cityCenter  || { lat: 39.92077, lng: 32.85411 },
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

  // Google session token (AC/Search oturumu)
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

  // preload local (+ match annotate)
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

        const withFlags = await annotateMatches(out || [], cityName);
        initialLocalRef.current = withFlags;
        setItems(withFlags);
        if (__DEV__) console.log('[TripListQuestion] local preload =', withFlags?.length || 0);
      } catch {
        if (mounted) {
          initialLocalRef.current = [];
          setItems([]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [activeCat, cityName, countryCode]);

  // 🔍 KEYPRESS (debounced): sadece autocomplete/suggest-first (tek çağrı akışı)
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
        const acList = await searchUnified(qTrim, {
          city: cityName,
          category: activeCat,
          lat: Number(cityCenter?.lat),
          lon: Number(cityCenter?.lng),
          sessionToken: sessionRef.current,
          isSubmit: false, // ⬅️ sadece AC / suggest-first
          limit: 12,
          timeoutMs: 9000,
        }).catch(() => []);

        // normalize (searchUnified AC çıktısı: google/suggest ağırlıklı)
        const norm = (acList || []).map(s => ({
          id: s.place_id ? `pid-${s.place_id}` : (s.id || `${s.name}-${s.lat},${s.lon}`),
          name: s.name || '—',
          address: s.address || '',
          source: s.source || 'google',
          place_id: s.place_id || null,
          coords: (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)))
            ? { lat: Number(s.lat), lng: Number(s.lon) }
            : undefined,
          category: activeCat || 'sights',
          city: s.city || cityName || '',
          rating: s.rating ?? null,
          user_ratings_total: s.user_ratings_total ?? null,
          price_level: s.price_level ?? null,
        }));

        const ded = dedupPlaces(norm);
        const withFlags = await annotateMatches(ded, cityName);

        if (!mounted || myReqId !== reqIdRef.current) return;
        setItems(withFlags);
        if (__DEV__) console.log('[TripListQuestion] AC items =', withFlags?.length || 0);

        if (withFlags.length) {
          persistGoogleResultsSilently(withFlags, { city: cityName, category: activeCat }).catch(() => {});
        }
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

  // ENTER / "Ara" → submit araması (gerekirse TextSearch; yine tek çağrı)
  const handleSubmit = async () => {
    const qTrim = (query || '').trim();
    if (!qTrim || qTrim.length < MIN_CHARS) return;
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const list = await searchUnified(qTrim, {
        city: cityName,
        category: activeCat,
        lat: Number(cityCenter?.lat),
        lon: Number(cityCenter?.lng),
        sessionToken: sessionRef.current || newPlacesSessionToken(),
        isSubmit: true, // ⬅️ submit → search
        limit: 24,
        timeoutMs: 10000,
      }).catch(() => []);

      const norm = (list || []).map(s => ({
        id: s.place_id ? `pid-${s.place_id}` : (s.id || `${s.name}-${s.lat},${s.lon}`),
        name: s.name || '—',
        address: s.address || '',
        source: s.source || 'google',
        place_id: s.place_id || null,
        coords: (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)))
          ? { lat: Number(s.lat), lng: Number(s.lon) }
          : undefined,
        category: activeCat || 'sights',
        city: s.city || cityName || '',
        rating: s.rating ?? null,
        user_ratings_total: s.user_ratings_total ?? null,
        price_level: s.price_level ?? null,
      }));

      const ded = dedupPlaces(norm);
      const withFlags = await annotateMatches(ded, cityName);

      if (myReqId !== reqIdRef.current) return;
      setItems(withFlags);
      if (__DEV__) console.log('[TripListQuestion] SUBMIT items =', withFlags?.length || 0);

      if (withFlags.length) {
        persistGoogleResultsSilently(withFlags, { city: cityName, category: activeCat }).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  function toggleSelection(item) {
    const cityKey = item.city || cityName;
    // place_id öncelikli eşitlik — aynı yer farklı kaynaktan gelse bile tek seçim
    const exists = selected.find((x) =>
      (item.place_id && x.place_id && x.place_id === item.place_id) ||
      (x.id === item.id && (x.city || '') === cityKey)
    );

    let next;
    if (exists) {
      next = selected.filter((x) =>
        !(
          (item.place_id && x.place_id && x.place_id === item.place_id) ||
          (x.id === item.id && (x.city || '') === cityKey)
        )
      );
    } else {
      const fallbackCat = item.category || activeCat || 'sights';
      const picked = toPlace(item, cityName, fallbackCat);
      next = [...selected, picked];

      // Google/suggest kaynağı ise → overlay’e kalıcı yaz
      const _lat = Number.isFinite(item.lat) ? item.lat : Number(item.coords?.lat);
      const _lon = Number.isFinite(item.lon) ? item.lon : Number(item.coords?.lng ?? item.coords?.lon);
      if ((item.source === 'google' || item.matched) && Number.isFinite(_lat) && Number.isFinite(_lon)) {
        addUserPoi({
          city: cityName,
          category: fallbackCat,
          name: item.name,
          lat: _lat,
          lon: _lon,
          address: item.address || '',
          place_id: item.place_id || undefined,
        }).catch(() => {});
        if (item.place_id) seenPersistIds.add(item.place_id);
      }
    }
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
          placeholder="Ara (önce öneriler; ENTER ile net arama)…"
          placeholderTextColor="#6B7280"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={handleSubmit} // ⬅️ Submit araması
        />
        {loading ? <ActivityIndicator /> : null}
      </View>

      {/* Mini sayaç */}
      <Text style={{color:'#9AA0A6', fontSize:12, marginTop:6, marginLeft:2}}>
        {`Listelenen: ${items?.length || 0}`}
      </Text>

      {/* Places list */}
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
            const checked = !!selected.find((x) =>
              (item.place_id && x.place_id && x.place_id === item.place_id) ||
              (x.id === item.id && (x.city || '') === cityKey)
            );
            const catForItem = item.category || activeCat || 'sights';

            const matched = !!item.matched || !!item.place_id;
            const isOverlayGoogle = item.source === 'google';

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
                    {!!item.address && (
                      <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>
                    )}
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {matched ? <Badge tone="green">Eşleşmiş</Badge> : <Badge>{isOverlayGoogle ? 'Google' : 'Yerel'}</Badge>}
                    {checked ? <Text style={styles.selectedPill}>Seçili</Text> : null}
                  </View>
                </View>

                <View style={{ marginTop: 8, flexDirection:'row', gap:6 }}>
                  <Text style={styles.catTagMini}>{labelForCat(catForItem)}</Text>
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

      {/* Seçilenler */}
      <View style={{ height: 12 }} />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Seçilenler {cityName ? `(${cityName})` : ''}</Text>
        <Text style={styles.sectionCount}>{selectedCityItems.length}</Text>
      </View>

      <View style={[styles.sheetDark, { paddingVertical: 8 }]}>
        <FlatList
          data={selectedCityItems}
          keyExtractor={(it, idx) => (it?.place_id ? `pid-${it.place_id}` : (it?.id ? `id-${it.id}` : `sel-${idx}`))}
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
                  {!!item.address && (
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
  if (it?.place_id) return `pid-${it.place_id}`;
  const la = Number(it?.lat ?? it?.coords?.lat);
  const lo = Number(it?.lon ?? it?.coords?.lng ?? it?.coords?.lon);
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    return `geo-${round5(la)},${round5(lo)}-${(it?.name || '').slice(0,24)}`;
  }
  if (it?.id) return `id-${it.id}`;
  return `row-${idx}`;
}

/* styles */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },

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
  catTagMini: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D0F14',
    backgroundColor: '#1FB2A6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },

  cardSelectedList: { backgroundColor: '#0F1420' },
  removeText: { color: '#FCA5A5', fontWeight: '700' },
});
