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
  Modal,
  Linking,
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
  searchUnified,
  updateTripSelectedPlaces,
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

const round5 = (x) => Math.round(Number(x) * 1e5) / 1e5;

// ✅ RN-safe basit id üretici
function generateTripId(prefix = 'trip') {
  const a = Date.now().toString(10);
  const b = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${a}_${b}`;
}

function toPlace(item, fallbackCity, fallbackCategory) {
  const lat = Number.isFinite(item.lat) ? item.lat : Number(item.coords?.lat);
  const lon = Number.isFinite(item.lon) ? item.lon : Number(item.coords?.lng ?? item.coords?.lon);
  return {
    id: item.place_id ? `pid-${item.place_id}`
      : String(item.id ?? `${(item.name||'x')}-${fallbackCity||''}-${Math.random().toString(36).slice(2)}`),
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

// aynı place_id’yi tekrar tekrar local’e basmayalım
const seenPersistIds = new Set();

function normalizeListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

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

    const res = await poiMatch({ items: payload }, cityName);
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

const ANKARA_FALLBACK = { lat: 39.92077, lng: 32.85411 };
const nearlySame = (a, b, eps = 1e-4) => Math.abs(Number(a) - Number(b)) <= eps;

const isAnkaraFallback = (c) => {
  if (!c) return true;
  const lat = Number(c.lat), lng = Number(c.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    nearlySame(lat, ANKARA_FALLBACK.lat) &&
    nearlySame(lng, ANKARA_FALLBACK.lng);
};

const isValidCenter = (c, cityName) => {
  const lat = Number(c?.lat);
  const lng = Number(c?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const city = String(cityName || '').toLowerCase();
  const looksLikeAnkara = city.includes('ankara');
  if (!looksLikeAnkara && isAnkaraFallback(c)) return false;
  return true;
};

function haversineKm(a, b) {
  const la1 = Number(a?.lat), lo1 = Number(a?.lng);
  const la2 = Number(b?.lat), lo2 = Number(b?.lng);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) return null;
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const aa = s1 * s1 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function openInGoogleMaps(item) {
  const pid = item?.place_id;
  const lat = Number.isFinite(item?.lat) ? item.lat : Number(item?.coords?.lat);
  const lng = Number.isFinite(item?.lon) ? item.lon : Number(item?.coords?.lng ?? item?.coords?.lon);

  if (pid) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item?.name || 'Place')}&query_place_id=${encodeURIComponent(pid)}`;
    Linking.openURL(url).catch(() => {});
    return;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
    return;
  }
  if (item?.name) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}`;
    Linking.openURL(url).catch(() => {});
  }
}

function resolveTripId(trip, tripIdProp) {
  const direct = tripIdProp;
  if (direct != null && String(direct).trim()) return String(direct);

  const candidates = [
    trip?.id,
    trip?._id,
    trip?.tripId,
    trip?.trip_id,
    trip?.uuid,
    trip?.key,
    trip?.meta?.id,
    trip?.meta?._id,
  ].filter(Boolean);

  if (candidates.length) return String(candidates[0]);
  return null;
}

function resolveCountryCode(trip, explicitCountryCode) {
  const direct = explicitCountryCode;
  if (direct && String(direct).trim()) return String(direct).toUpperCase();

  const candidates = [
    trip?.countryCode,
    trip?.country_code,
    trip?.country?.code,
    trip?.where?.countryCode,
    trip?.meta?.countryCode,
  ].filter(Boolean);

  if (candidates.length) return String(candidates[0]).toUpperCase();
  return 'TR';
}

export default function TripListQuestion({
  trip,
  setTrip,
  onBack,
  onNext,
  tripId: tripIdProp,
  countryCode: countryCodeProp,
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

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);

  const selected = useMemo(() => trip?.selectedPlaces || [], [trip?.selectedPlaces]);
  const selectedCityItems = useMemo(
    () => (selected || []).filter((x) => (x.city || '') === (cityName || '')),
    [selected, cityName]
  );

  const tripId = useMemo(() => resolveTripId(trip, tripIdProp), [trip, tripIdProp]);
  const countryCode = useMemo(() => resolveCountryCode(trip, countryCodeProp), [trip, countryCodeProp]);

  // ✅ NEW: parent state gelmeden de “id” kaybolmasın diye lokal bir id tut
  const localTripIdRef = useRef(null);

  const getEffectiveTripId = () => {
    // 1) prop/memo’dan gelen
    if (tripId) return String(tripId);
    // 2) lokal ref
    if (localTripIdRef.current) return String(localTripIdRef.current);
    // 3) son çare üret
    const gen = generateTripId('trip');
    localTripIdRef.current = gen;
    return gen;
  };

  // ✅ TripId yoksa, ilk render’da üret (tek sefer) + localTripIdRef’e yaz
  const ensuredTripIdRef = useRef(false);
  useEffect(() => {
    if (tripId) {
      // parent güncellediyse, lokal ref’i de senkron tut
      localTripIdRef.current = String(tripId);
      return;
    }
    if (ensuredTripIdRef.current) return;
    ensuredTripIdRef.current = true;

    const newId = getEffectiveTripId();

    const nextTrip = {
      ...(trip || {}),
      id: newId,
      tripId: newId,
    };

    if (__DEV__) {
      console.log('[TripListQuestion] ensureTripId → created local id', {
        newId,
        beforeKeys: Object.keys(trip || {}),
        after: { id: nextTrip.id, tripId: nextTrip.tripId },
      });
    }

    setTrip?.(nextTrip);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, setTrip]);

  // ✅ selectedPlaces persist (debounced)
  const persistTimerRef = useRef(null);
  const persistLatestRef = useRef({ tripId: null, selectedPlaces: [] });
  const persistInFlightRef = useRef(false);

  const schedulePersistSelectedPlaces = (tripIdValue, nextSelectedPlaces) => {
    const safeTripId = tripIdValue || getEffectiveTripId();

    persistLatestRef.current = {
      tripId: safeTripId,
      selectedPlaces: Array.isArray(nextSelectedPlaces) ? nextSelectedPlaces : [],
    };

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      const latest = persistLatestRef.current;
      if (!latest?.tripId) return;
      if (persistInFlightRef.current) return;

      persistInFlightRef.current = true;
      try {
        if (__DEV__) console.log('[TripListQuestion] persist selectedPlaces →', latest.selectedPlaces?.length || 0, { tripId: latest.tripId });
        await updateTripSelectedPlaces(latest.tripId, latest.selectedPlaces, { timeoutMs: 15000 });
        if (__DEV__) console.log('[TripListQuestion] persist OK');
      } catch (e) {
        if (__DEV__) console.warn('[TripListQuestion] persist FAIL:', e?.message || e);
      } finally {
        persistInFlightRef.current = false;
      }
    }, 400);
  };

  // ✅ tripId geldiğinde (ya da lokal id hazırken) pending varsa bas
  useEffect(() => {
    const effectiveId = getEffectiveTripId();
    const pending = persistLatestRef.current?.selectedPlaces;
    const candidate = (Array.isArray(pending) && pending.length) ? pending : (trip?.selectedPlaces || []);
    if (Array.isArray(candidate) && candidate.length) {
      schedulePersistSelectedPlaces(effectiveId, candidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]); // intentionally only tripId

  useEffect(() => {
    return () => {
      try {
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      } catch {}
      const latest = persistLatestRef.current;
      if (latest?.tripId && Array.isArray(latest.selectedPlaces)) {
        updateTripSelectedPlaces(latest.tripId, latest.selectedPlaces, { timeoutMs: 8000 }).catch(() => {});
      }
    };
  }, []);

  // session token
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
        const finalList = dedupPlaces(withFlags);
        initialLocalRef.current = finalList;
        setItems(finalList);
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

  // debounced autocomplete
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

      const centerOk = isValidCenter(cityCenter, cityName);
      const lat = centerOk ? Number(cityCenter?.lat) : undefined;
      const lng = centerOk ? Number(cityCenter?.lng) : undefined;

      try {
        const acPayload = await searchUnified(qTrim, {
          city: cityName,
          category: activeCat,
          lat,
          lng,
          lon: lng,
          sessionToken: sessionRef.current,
          isSubmit: false,
          limit: 12,
          timeoutMs: 9000,
        }).catch(() => ([]));

        const acList = normalizeListPayload(acPayload);

        const norm = (acList || []).map(s => ({
          id: s.place_id ? `pid-${s.place_id}` : (s.id || `${s.name}-${s.lat},${s.lon}`),
          name: s.name || '—',
          address: s.address || '',
          source: s.source || 'google',
          place_id: s.place_id || null,
          coords: (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon ?? s.lng)))
            ? { lat: Number(s.lat), lng: Number(s.lon ?? s.lng) }
            : undefined,
          category: activeCat || 'sights',
          city: s.city || cityName || '',
          rating: s.rating ?? null,
          user_ratings_total: s.user_ratings_total ?? null,
          matched: s.matched ?? null,
          lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : undefined,
          lon: Number.isFinite(Number(s.lon ?? s.lng)) ? Number(s.lon ?? s.lng) : undefined,
        }));

        const ded = dedupPlaces(norm);
        const withFlags = await annotateMatches(ded, cityName);
        const finalList = dedupPlaces(withFlags);

        if (!mounted || myReqId !== reqIdRef.current) return;
        setItems(finalList);
      } finally {
        if (mounted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      mounted = false;
      if (debRef.current) clearTimeout(debRef.current);
    };
  }, [query, activeCat, cityName, cityCenter?.lat, cityCenter?.lng]);

  const handleSubmit = async () => {
    const qTrim = (query || '').trim();
    if (!qTrim || qTrim.length < MIN_CHARS) return;

    const myReqId = ++reqIdRef.current;
    setLoading(true);

    const centerOk = isValidCenter(cityCenter, cityName);
    const lat = centerOk ? Number(cityCenter?.lat) : undefined;
    const lng = centerOk ? Number(cityCenter?.lng) : undefined;

    try {
      const payload = await searchUnified(qTrim, {
        city: cityName,
        category: activeCat,
        lat,
        lng,
        lon: lng,
        sessionToken: sessionRef.current || newPlacesSessionToken(),
        isSubmit: true,
        limit: 24,
        timeoutMs: 10000,
      }).catch(() => ([]));

      const list = normalizeListPayload(payload);

      const norm = (list || []).map(s => ({
        id: s.place_id ? `pid-${s.place_id}` : (s.id || `${s.name}-${s.lat},${s.lon}`),
        name: s.name || '—',
        address: s.address || '',
        source: s.source || 'google',
        place_id: s.place_id || null,
        coords: (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon ?? s.lng)))
          ? { lat: Number(s.lat), lng: Number(s.lon ?? s.lng) }
          : undefined,
        category: activeCat || 'sights',
        city: s.city || cityName || '',
        rating: s.rating ?? null,
        user_ratings_total: s.user_ratings_total ?? null,
        matched: s.matched ?? null,
        lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : undefined,
        lon: Number.isFinite(Number(s.lon ?? s.lng)) ? Number(s.lon ?? s.lng) : undefined,
      }));

      const ded = dedupPlaces(norm);
      const withFlags = await annotateMatches(ded, cityName);
      const finalList = dedupPlaces(withFlags);

      if (myReqId !== reqIdRef.current) return;
      setItems(finalList);
    } finally {
      setLoading(false);
    }
  };

  function isChecked(item) {
    const cityKey = item.city || cityName;
    return !!selected.find((x) =>
      (item.place_id && x.place_id && x.place_id === item.place_id) ||
      (x.id === item.id && (x.city || '') === cityKey)
    );
  }

  // ✅ KRİTİK: toggleSelection içinde “effectiveTripId” kullan
  function toggleSelection(item) {
    const cityKey = item.city || cityName;
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

      const _lat = Number.isFinite(item.lat) ? item.lat : Number(item.coords?.lat);
      const _lon = Number.isFinite(item.lon) ? item.lon : Number(item.coords?.lng ?? item.coords?.lon);
      if ((item.source === 'google' || item.matched) && Number.isFinite(_lat) && Number.isFinite(_lon)) {
        addUserPoi({
          country: countryCode,
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

    const ensuredId = getEffectiveTripId();
    localTripIdRef.current = ensuredId;

    const nextTrip = {
      ...(trip || {}),
      id: (trip?.id || trip?.tripId || ensuredId),
      tripId: (trip?.tripId || trip?.id || ensuredId),
      selectedPlaces: next,
    };

    setTrip?.(nextTrip);

    // ✅ artık “SKIP” yok: her zaman effective id ile persist
    schedulePersistSelectedPlaces(ensuredId, next);
  }

  function openPreview(item) {
    setPreviewItem(item);
    setPreviewOpen(true);
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewItem(null);
  }

  const previewInfo = useMemo(() => {
    const it = previewItem;
    if (!it) return null;
    const lat = Number.isFinite(it?.lat) ? it.lat : Number(it?.coords?.lat);
    const lng = Number.isFinite(it?.lon) ? it.lon : Number(it?.coords?.lng ?? it?.coords?.lon);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const centerOk = isValidCenter(cityCenter, cityName);
    const km = hasCoords && centerOk ? haversineKm({ lat, lng }, cityCenter) : null;

    return {
      hasCoords, lat, lng, centerOk, km,
      checked: isChecked(it),
      sourceLabel: (it?.matched || it?.place_id) ? 'Eşleşmiş' : (it?.source === 'google' ? 'Google' : 'Yerel'),
      catLabel: labelForCat(it?.category || activeCat || 'sights'),
    };
  }, [previewItem, cityCenter, cityName, activeCat, selected]);

  const effectiveTripId = tripId || localTripIdRef.current || null;

  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} keyboardShouldPersistTaps="always">
        <View style={{ flexDirection: 'row' }}>
          {CATEGORIES.map((c) => {
            const active = c.key === activeCat;
            const count = catCounts?.[c.key] || 0;
            return (
              <Pressable key={c.key} onPress={() => setActiveCat(c.key)} style={[styles.tab, active && styles.tabActive]}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {c.label}{count ? ` (${count})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

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
          onSubmitEditing={handleSubmit}
        />
        {loading ? <ActivityIndicator /> : null}
      </View>

      <Text style={{color:'#9AA0A6', fontSize:12, marginTop:6, marginLeft:2}}>
        {`Listelenen: ${items?.length || 0}  ·  tripId: ${effectiveTripId || '(missing)'}  ·  country: ${countryCode}`}
      </Text>

      <View style={[styles.sheetDark, { maxHeight: placesMaxHeight }]}>
        <GHFlatList
          data={items}
          keyExtractor={(it, idx) => {
            const base = it?.place_id ? `pid-${it.place_id}` : (it?.id ? `id-${it.id}` : 'row');
            return `${base}#${idx}`;
          }}
          extraData={selected}
          nestedScrollEnabled
          scrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const checked = isChecked(item);
            const catForItem = item.category || activeCat || 'sights';
            const matched = !!item.matched || !!item.place_id;

            const lat = Number.isFinite(item?.lat) ? item.lat : Number(item?.coords?.lat);
            const lng = Number.isFinite(item?.lon) ? item.lon : Number(item?.coords?.lng ?? item?.coords?.lon);
            const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
            const centerOk = isValidCenter(cityCenter, cityName);
            const km = hasCoords && centerOk ? haversineKm({ lat, lng }, cityCenter) : null;

            return (
              <Pressable onPress={() => openPreview(item)} style={[styles.card, checked && styles.cardChecked]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#0D0F14" /> : null}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                    {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
                    <Text style={styles.metaLine} numberOfLines={1}>
                      {hasCoords ? `📍 ${round5(lat)}, ${round5(lng)}` : '📍 Koordinat yok'}
                      {km != null ? `  ·  ≈ ${km.toFixed(1)} km` : ''}
                      {item?.place_id ? '  ·  place_id' : ''}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {matched ? <Badge tone="green">Eşleşmiş</Badge> : <Badge>Yer</Badge>}
                    {checked ? <Text style={styles.selectedPill}>Seçili</Text> : null}
                  </View>
                </View>

                <View style={{ marginTop: 8, flexDirection:'row', gap:6, alignItems:'center', justifyContent:'space-between' }}>
                  <Text style={styles.catTagMini}>{labelForCat(catForItem)}</Text>
                  <Text style={styles.tapHint}>Dokun → Doğrula</Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>

      <Modal visible={previewOpen} transparent animationType="fade" onRequestClose={closePreview}>
        <Pressable style={styles.modalOverlay} onPress={closePreview}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <Text style={styles.modalTitle} numberOfLines={2}>{previewItem?.name || '—'}</Text>
              <Pressable onPress={closePreview} style={styles.iconBtn}>
                <Ionicons name="close" size={18} color="#E5E7EB" />
              </Pressable>
            </View>

            {!!previewItem?.address && <Text style={styles.modalAddr} numberOfLines={3}>{previewItem.address}</Text>}

            <View style={{ flexDirection:'row', gap:8, marginTop: 10, flexWrap:'wrap' }}>
              <Badge tone={previewInfo?.sourceLabel === 'Eşleşmiş' ? 'green' : 'blue'}>
                {previewInfo?.sourceLabel || '—'}
              </Badge>
              <Badge tone="indigo">{previewInfo?.catLabel || '—'}</Badge>
            </View>

            <View style={{ marginTop: 12 }}>
              <Text style={styles.modalMeta}>
                {previewInfo?.hasCoords
                  ? `Koordinat: ${round5(previewInfo.lat)}, ${round5(previewInfo.lng)}`
                  : 'Koordinat: Yok'}
              </Text>
              <Text style={styles.modalMeta}>
                {previewInfo?.km != null ? `Merkeze uzaklık: ≈ ${previewInfo.km.toFixed(1)} km` : 'Uzaklık: (hesaplanamadı)'}
              </Text>
              {!!previewItem?.place_id && <Text style={styles.modalMeta}>place_id: {String(previewItem.place_id).slice(0, 18)}…</Text>}
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable onPress={() => openInGoogleMaps(previewItem)} style={[styles.modalBtn, styles.modalBtnGhost]}>
                <Ionicons name="map-outline" size={16} color="#E5E7EB" />
                <Text style={styles.modalBtnTextGhost}>Google Maps’te Aç</Text>
              </Pressable>

              <Pressable
                onPress={() => { toggleSelection(previewItem); closePreview(); }}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
              >
                <Ionicons
                  name={previewInfo?.checked ? "remove-circle-outline" : "add-circle-outline"}
                  size={16}
                  color="#0D0F14"
                />
                <Text style={styles.modalBtnTextPrimary}>{previewInfo?.checked ? 'Kaldır' : 'Ekle'}</Text>
              </Pressable>
            </View>

            <Text style={styles.modalHint}>
              İpucu: Emin değilsen “Google Maps’te Aç” ile kontrol edip sonra “Ekle”.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={{ height: 12 }} />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
  Seçilenler {cityName ? `(${cityName})` : ''}
</Text>

        <Text style={styles.sectionCount}>{selectedCityItems.length}</Text>
      </View>

      <View style={[styles.sheetDark, { paddingVertical: 8 }]}>
        <FlatList
          data={selectedCityItems}
          keyExtractor={(it, idx) =>
            (it?.place_id ? `pid-${it.place_id}` : (it?.id ? `id-${it.id}` : 'sel')) + `#${idx}`
          }
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { paddingBottom: 6 }]}
          renderItem={({ item }) => (
            <Pressable onPress={() => openPreview(item)} style={[styles.card, styles.cardSelectedList]}>
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
                  {!!item.address && <Text style={styles.addr} numberOfLines={1}>{item.address}</Text>}
                </View>
                <Text style={styles.removeText}>Dokun</Text>
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
  metaLine: { color: '#6B7280', fontSize: 11, marginTop: 6 },

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
  tapHint: { color: '#6B7280', fontSize: 11, fontWeight: '700' },
  cardSelectedList: { backgroundColor: '#0F1420' },
  removeText: { color: '#FCA5A5', fontWeight: '700' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 18,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#0B0D12',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2d36',
    padding: 14,
  },
  modalTitle: { color: '#fff', fontWeight: '900', fontSize: 16, flex: 1 },
  modalAddr: { color: '#9AA0A6', marginTop: 8, lineHeight: 18 },
  modalMeta: { color: '#C7D2FE', marginTop: 6, fontSize: 12 },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  modalBtnGhost: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
  },
  modalBtnPrimary: { backgroundColor: '#60A5FA' },
  modalBtnTextGhost: { color: '#E5E7EB', fontWeight: '900' },
  modalBtnTextPrimary: { color: '#0D0F14', fontWeight: '900' },
  modalHint: { color: '#6B7280', marginTop: 10, fontSize: 12 },
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
  },
});
