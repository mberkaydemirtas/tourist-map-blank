// RoutePlannerCard.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  FlatList,
  Modal,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useLocation } from '../map/hooks/useLocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete, getPlaceDetails } from '../map/maps';

/* ===== Debug helpers ===== */
const DEBUG = true; // ← kapatmak için false yap
const dlog = (...args) => DEBUG && console.log('[RoutePlanner]', ...args);
const plog = (...args) => DEBUG && console.log('[PlacePicker]', ...args);

let DraggableFlatList = null;
const USE_DRAGGABLE = true;
try {
  DraggableFlatList = require('react-native-draggable-flatlist').default;
} catch (e) {
  DraggableFlatList = null;
}

/* -------------------- yardımcılar -------------------- */
// eksik koordinatları çözen yardımcılar
const ensureLatLngFromDetails = async (item) => {
  if (!item) return item;
  const hasCoords =
    item.coords && typeof item.coords.latitude === 'number' && typeof item.coords.longitude === 'number';
  if (hasCoords) return item;

  if (!item.place_id) return item; // çözebileceğimiz bir şey yok
  try {
    const det = await getPlaceDetails(item.place_id);
    const coordsResolved = toLatLng(det?.coords || det?.location || det?.geometry?.location);
    return {
      ...item,
      coords: coordsResolved || null,
      name: item.name || det?.name || null,
      address: item.address || det?.formatted_address || det?.vicinity || null,
      rating: item.rating ?? det?.rating ?? null,
      user_ratings_total: item.user_ratings_total ?? det?.user_ratings_total ?? null,
    };
  } catch {
    return item;
  }
};

const resolveAllStops = async ({ from, waypoints, to }) => {
  const toResolve = [
    ensureLatLngFromDetails(from),
    ...waypoints.map(w => ensureLatLngFromDetails(w)),
    ensureLatLngFromDetails(to),
  ];
  const [fromR, ...rest] = await Promise.all(toResolve);
  const toR = rest.pop();
  const wpsR = rest;
  return { fromR, wpsR, toR };
};

const toLatLng = (any) => {
  if (!any) return null;
  if (typeof any.latitude === 'number' && typeof any.longitude === 'number') {
    return { latitude: any.latitude, longitude: any.longitude };
  }
  if (typeof any.lat === 'number' && typeof any.lng === 'number') {
    return { latitude: any.lat, longitude: any.lng };
  }
  if (Array.isArray(any) && any.length >= 2 && typeof any[0] === 'number' && typeof any[1] === 'number') {
    return { latitude: any[0], longitude: any[1] };
  }
  // Google LatLng objesi: lat(), lng()
  if (typeof any.lat === 'function' && typeof any.lng === 'function') {
    try {
      const lat = Number(any.lat());
      const lng = Number(any.lng());
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { latitude: lat, longitude: lng };
    } catch {}
  }
  return null;
};

const makeStop = (patch = {}) => ({
  id: String(Math.random()),
  name: null,
  place_id: null,
  coords: null,
  address: null,
  rating: null,
  user_ratings_total: null,
  ...patch,
});

const HISTORY_KEY = 'route_planner_place_history_v1';
const saveToHistory = async (item) => {
  try {
    const raw = (await AsyncStorage.getItem(HISTORY_KEY)) || '[]';
    const list = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    const idx = list.findIndex((x) => x.place_id === item.place_id);
    const base = {
      name: item.name ?? null,
      place_id: item.place_id ?? null,
      coords: item.coords ?? null,
      address: item.address ?? null,
      rating: item.rating ?? null,
      user_ratings_total: item.user_ratings_total ?? null,
    };
    let next;
    if (idx === -1) {
      // yeni kayıt başa
      next = [base, ...list];
    } else {
      // var olanı bilgileri kaybetmeden güncelle
      next = [...list];
      next[idx] = {
        ...next[idx],
        ...base,
        // coords ve rating gibi alanlarda "daha dolu olan" kazansın
        coords: base.coords ?? next[idx].coords ?? null,
        rating: base.rating ?? next[idx].rating ?? null,
        user_ratings_total: base.user_ratings_total ?? next[idx].user_ratings_total ?? null,
        address: base.address ?? next[idx].address ?? null,
        name: base.name ?? next[idx].name ?? null,
      };
      // güncelleneni başa al (MRU)
      const updated = next.splice(idx, 1)[0];
      next = [updated, ...next];
    }
    next = next.slice(0, 10);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    dlog('saveToHistory ok', { place_id: item.place_id, name: item.name });
  } catch (e) {
    dlog('saveToHistory error', e?.message);
  }
};
const loadHistory = async () => {
  try {
    const raw = (await AsyncStorage.getItem(HISTORY_KEY)) || '[]';
    const list = JSON.parse(raw);
    dlog('loadHistory', { count: list.length });
    return list;
  } catch {
    return [];
  }
};

const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

const formatDetails = (item) => {
  const parts = [];
  if (item.address) parts.push(item.address);
  if (item.rating) {
    parts.push(`${item.rating.toFixed ? item.rating.toFixed(1) : item.rating}★${item.user_ratings_total ? ` (${item.user_ratings_total})` : ''}`);
  }
  if (parts.length === 0 && item?.coords) {
    parts.push(`${(+item.coords.latitude).toFixed?.(5)}, ${(+item.coords.longitude).toFixed?.(5)}`);
  }
  if (parts.length === 0 && item.place_id) parts.push(`#${String(item.place_id).slice(0, 6)}`);
  return parts.join(' • ');
};

/* -------------------- PlacePickerOverlay -------------------- */
function PlacePickerOverlay({ visible, onClose, onPick, placeholder = 'Yer ara' }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!visible) return;
    (async () => setHistory(await loadHistory()))();
    setQ('');
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (dq.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await autocomplete(dq.trim());
        plog('autocomplete', dq.trim(), { count: res?.length ?? 0 });
        if (!cancelled) setSuggestions(res || []);
      } catch (e) {
        plog('autocomplete error', e?.message);
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [dq]);

  const pickPlace = (pred) => {
    const item = {
      name: pred?.structured_formatting?.main_text || pred?.description || 'Seçilen yer',
      place_id: pred.place_id,
      coords: null,
      address: pred?.structured_formatting?.secondary_text || null,
      rating: null,
      user_ratings_total: null,
    };
    plog('pickPlace → onPick', { place_id: item.place_id, name: item.name });
    onPick?.(item);
  };

  const renderSuggestion = ({ item }) => (
    <TouchableOpacity style={styles.suggestRow} onPress={() => pickPlace(item)}>
      <Text style={styles.suggestTitle} numberOfLines={1}>
        {item.structured_formatting?.main_text || item.description}
      </Text>
      <Text style={styles.suggestSub} numberOfLines={1}>
        {item.structured_formatting?.secondary_text || ''}
      </Text>
    </TouchableOpacity>
  );

  const renderHistory = ({ item }) => (
    <TouchableOpacity
      style={styles.suggestRow}
      onPress={() => {
        plog('history pick → onPick', { place_id: item.place_id, name: item.name, hasCoords: !!item.coords });
        onPick?.({ ...item, coords: toLatLng(item.coords) || item.coords });
      }}
    >
      <Text style={styles.suggestTitle} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.suggestSub} numberOfLines={1}>
        {item.address
          ? item.address
          : item.coords
          ? `${item.coords.latitude.toFixed(5)}, ${item.coords.longitude.toFixed(5)}`
          : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={() => { plog('onRequestClose'); onClose?.(); }}
    >
      <SafeAreaView style={styles.overlayFull}>
        <View style={styles.overlayTopBar}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={placeholder}
            placeholderTextColor="#7f8695"
            style={styles.searchInputTop}
            autoFocus
            returnKeyType="search"
          />
          <TouchableOpacity onPress={() => { plog('Close button'); onClose?.(); }} hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}>
            <Text style={styles.overlayCloseTop}>Kapat</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingRowTop}>
            <ActivityIndicator />
            <Text style={styles.loadingTxt}>Aranıyor…</Text>
          </View>
        ) : null}

        {q.trim().length >= 2 ? (
          <FlatList
            data={suggestions}
            keyExtractor={(it, idx) => it.place_id || String(idx)}
            renderItem={renderSuggestion}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        ) : (
          <FlatList
            data={history}
            keyExtractor={(it, idx) => it.place_id || String(idx)}
            renderItem={renderHistory}
            ListHeaderComponent={<Text style={styles.historyTitle}>Geçmiş</Text>}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16 }}
            ListEmptyComponent={<Text style={styles.emptyTxt}>Henüz geçmiş yok</Text>}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* -------------------- RoutePlannerCard -------------------- */
export default function RoutePlannerCard() {
  const navigation = useNavigation();
  const { coords } = useLocation();

  // Başlangıç: sabit (Konumunuz)
  const from = useMemo(() => ({
    id: 'from',
    name: 'Konumunuz',
    place_id: null,
    coords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
    address: null,
    rating: null,
    user_ratings_total: null,
  }), [coords]);

  // stops = [from, ...waypoints, to]
  const [waypoints, setWaypoints] = useState([]);
  const [to, setTo] = useState(null);

  const stops = useMemo(
    () => [from, ...waypoints, to || { id: 'to-null', name: null, place_id: null, coords: null }],
    [from, waypoints, to]
  );

  const isFirst = (i) => i === 0;
  const isLast  = (i) => i === stops.length - 1;

  // Overlay kontrolü
  const [pickerVisible, setPickerVisible] = useState(false);
  const targetIndexRef = useRef(null);

  const openPickerForIndex = (index) => {
    const n = Number(index);
    if (!Number.isFinite(n)) { dlog('openPickerForIndex ignored (invalid index)', index); return; }
    dlog('openPickerForIndex', n);
    targetIndexRef.current = n;
    setPickerVisible(true);
  };
  const closePicker = () => {
    dlog('closePicker()');
    setPickerVisible(false);
    targetIndexRef.current = null; // manuel kapama
  };

  // Optimistic satır doldurma
  const fillRowOptimistic = (idx, base) => {
    dlog('fillRowOptimistic', { idx, baseHasCoords: !!base.coords, base });
    if (isLast(idx)) {
      setTo((prev) => ({
        id: 'to',
        name: base.name ?? prev?.name ?? null,
        place_id: base.place_id ?? prev?.place_id ?? null,
        coords: base.coords ?? prev?.coords ?? null,
        address: base.address ?? prev?.address ?? null,
        rating: base.rating ?? prev?.rating ?? null,
        user_ratings_total: base.user_ratings_total ?? prev?.user_ratings_total ?? null,
      }));
      return;
    }
    const wpIndex = idx - 1;
    setWaypoints((prev) => {
      const arr = [...prev];
      if (!arr[wpIndex]) arr.splice(wpIndex, 0, makeStop());
      arr[wpIndex] = { ...arr[wpIndex], ...base };
      return arr;
    });
  };

  const resolveCoordsLater = async (idx, base) => {
    if (base.coords || !base.place_id) {
      dlog('resolveCoordsLater skipped', { hasCoords: !!base.coords, hasPlaceId: !!base.place_id });
      return;
    }
    try {
      const det = await getPlaceDetails(base.place_id);
      const coordsResolved = toLatLng(det?.coords || det?.location || det?.geometry?.location);
      dlog('getPlaceDetails result', {
        name: det?.name,
        hasCoords: !!coordsResolved,
        geometryType: det?.geometry && typeof det?.geometry?.location,
      });
      const patch = {
        name: base.name || det?.name || null,
        coords: coordsResolved || null,
        address: base.address || det?.formatted_address || det?.vicinity || null,
        rating: base.rating ?? det?.rating ?? null,
        user_ratings_total: base.user_ratings_total ?? det?.user_ratings_total ?? null,
      };

       if (isLast(idx)) {
         setTo((prev) => ({ ...(prev || { id: 'to' }), ...patch }));
         await saveToHistory({ ...(base || {}), ...patch }); // coords olmasa da upsert
         return;
       }

      const wpIndex = idx - 1;
      setWaypoints((prev) => {
        const arr = [...prev];
        if (!arr[wpIndex]) arr.splice(wpIndex, 0, makeStop());
        arr[wpIndex] = { ...arr[wpIndex], ...patch };
        return arr;
      });
      await saveToHistory({ ...(base || {}), ...patch });
    } catch (e) {
      dlog('getPlaceDetails error', e?.message);
    }
  };

  // Seçim uygulanması
  const applyPickedPlace = async (picked) => {
    const idx = targetIndexRef.current;
    dlog('applyPickedPlace called', { idx, picked });
    setPickerVisible(false);

    const base = {
      name: picked?.name || 'Seçilen yer',
      place_id: picked?.place_id || null,
      coords: toLatLng(picked?.coords) || picked?.coords || null,
      address: picked?.address ?? null,
      rating: picked?.rating ?? null,
      user_ratings_total: picked?.user_ratings_total ?? null,
    };
    dlog('normalized base', base);

    if (!Number.isFinite(idx)) { dlog('applyPickedPlace: idx invalid → bail'); targetIndexRef.current = null; return; }
    if (isFirst(idx)) { dlog('applyPickedPlace: first row (start) is fixed → ignore'); targetIndexRef.current = null; return; }

    // 1) Optimistic yaz
    fillRowOptimistic(idx, base);
    // 1.b) HEMEN geçmişe yaz (coords olmasa da)
   if (base.place_id) {
     saveToHistory(base);
   }
    // 2) Koordinat eksikse detaydan tamamla
    resolveCoordsLater(idx, base);

    targetIndexRef.current = null;
  };

  /* --------- ekleme/silme/yer değiştir --------- */
   const insertAt = (index) => {
     // Kullanıcı bir yer seçerse applyPickedPlace içinde eklenecek.
     dlog('insertAt (deferred)', { index });
     openPickerForIndex(index);
   };

  const deleteAt = (index) => {
    if (isFirst(index) || isLast(index)) return;
    const wpIndex = index - 1;
    dlog('deleteAt', { index, wpIndex });
    setWaypoints((prev) => prev.filter((_, i) => i !== wpIndex));
  };

  const replaceAt = (index) => {
    if (isFirst(index)) { dlog('replaceAt ignored (start row)'); return; }
    dlog('replaceAt', index);
    openPickerForIndex(index);
  };

  // Waypoint’ler yalnızca 1..len-2 aralığında taşınabilir (başlangıç/bitiş sınırları korunur)
  const moveStop = (fromIdx, toIdx) => {
    const min = 1;
    const max = stops.length - 2;
    if (fromIdx < min || fromIdx > max) return;
    const clampedTo = Math.max(min, Math.min(max, toIdx));
    if (fromIdx === clampedTo) return;

    const fromWp = fromIdx - 1;
    const toWp = clampedTo - 1;

    dlog('moveStop', { fromIdx, toIdx, clampedTo, fromWp, toWp });

    setWaypoints((prev) => {
      const arr = [...prev];
      const it = arr.splice(fromWp, 1)[0];
      arr.splice(toWp, 0, it);
      return arr;
    });
  };

  const createRoute = async () => {
  dlog('createRoute click', {
    fromHas: !!from.coords,
    toHas: !!to?.coords,
    wps: waypoints.map((w, i) => ({ i, has: !!w?.coords, name: w?.name })),
  });

  if (!from.coords || !(to?.coords || to?.place_id)) {
    console.warn('Lütfen başlangıç (otomatik) ve bitiş seçin.');
    return;
  }

  // ⤵️ Tüm eksik koordinatları senkron çöz
  const { fromR, wpsR, toR } = await resolveAllStops({
    from,
    waypoints,
    to,
  });

  if (!fromR?.coords || !toR?.coords) {
    console.warn('Konum ayrıntıları alınamadı. Lütfen tekrar deneyin.');
    return;
  }

  const cleanWps = wpsR
    .filter(w => w && w.coords) // coords’u çözülebilmiş olanları al
    .map(w => ({
      lat: w.coords.latitude,
      lng: w.coords.longitude,
      name: w.name,
      place_id: w.place_id || null,
      address: w.address,
    }));

  dlog('createRoute → resolved', {
    from: fromR.coords,
    to: toR.coords,
    wpCount: cleanWps.length,
  });

  navigation.navigate('Map', {
    entryPoint: 'route-planner',
    routeRequest: {
      from: { lat: fromR.coords.latitude, lng: fromR.coords.longitude, place_id: fromR.place_id || null, name: fromR.name || 'Başlangıç' },
      to:   { lat: toR.coords.latitude,   lng: toR.coords.longitude,   place_id: toR.place_id   || null, name: toR.name   || 'Bitiş' },
      waypoints: cleanWps,
      mode: 'driving',
      autoDraw: true,
    },
  });
};


  /* --------- debug watchers --------- */
  useEffect(() => {
    dlog('waypoints changed →', waypoints.map((w,i)=>({
      i, name:w?.name, hasCoords:!!w?.coords, place_id:w?.place_id
    })));
  }, [waypoints]);
  useEffect(() => {
    dlog('to changed →', to && { name: to?.name, hasCoords: !!to?.coords, place_id: to?.place_id });
  }, [to]);

  /* -------------------- render -------------------- */

  const Badge = ({ i }) => (
    <View style={styles.badgeWrap}>
      {isFirst(i) && <Text style={[styles.badge, styles.badgeStart]}>Başlangıç</Text>}
      {isLast(i)  && <Text style={[styles.badge, styles.badgeEnd]}>Bitiş</Text>}
    </View>
  );

  const InsertBar = ({ index }) => (
    <TouchableOpacity activeOpacity={0.9} onPress={() => insertAt(index)} style={styles.insertBar}>
      <Text style={styles.insertText}>＋ Yeni durak buraya</Text>
    </TouchableOpacity>
  );

  const Row = ({ item, drag, isActive, i }) => {
    const canDelete    = !isFirst(i) && !isLast(i);
    const canReplace   = !isFirst(i);
    const dragDisabled = isFirst(i) || isLast(i);

    const title =
      item?.name ||
      (isFirst(i) ? 'Konumunuz' : isLast(i) ? 'Bitiş seç' : `Durak ${i}`);

    const hasAny = !!(item?.name || item?.place_id || item?.coords);
    const sub =
      hasAny
        ? (item?.name && !item?.coords ? 'Koordinat alınıyor…' : formatDetails(item))
        : (isLast(i) ? '— bitiş seçilmedi —'
            : isFirst(i) ? (from.coords ? '—' : '— konum alınıyor —')
            : '— durak seçilmedi —');

    return (
      <View style={[styles.row, isActive && styles.rowActive]}>
        <TouchableOpacity
          style={[styles.dragHandle, (dragDisabled || !DraggableFlatList) && { opacity: 0.35 }]}
          onLongPress={drag}
          delayLongPress={120}
          disabled={dragDisabled || !DraggableFlatList || !USE_DRAGGABLE}
        >
          <Text style={styles.dragIcon}>≡</Text>
        </TouchableOpacity>

        <View style={styles.rowCenter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
            <Badge i={i} />
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
        </View>

        <View style={styles.rowActions}>
          {canReplace && (
            <TouchableOpacity
              style={[styles.miniBtn, styles.replaceBtn]}
              onPress={() => replaceAt(i)}
            >
              <Text style={styles.miniTxt}>{hasAny ? 'Değiştir' : 'Seç'}</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity style={[styles.miniBtn, styles.delBtn]} onPress={() => deleteAt(i)}>
              <Text style={[styles.miniTxt, styles.delTxt]}>Sil</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // Draggable ve FlatList için GÜVENLİ index hesaplayıcı
  const getSafeIndex = (params, item) => {
    if (typeof params.index === 'number') return params.index;
    if (typeof params.getIndex === 'function') {
      const gi = params.getIndex();
      if (typeof gi === 'number') return gi;
    }
    const fi = stops.findIndex((s) => s?.id && item?.id && s.id === item.id);
    return fi >= 0 ? fi : 0;
  };

  const renderItem = (params) => {
    const { item, drag, isActive } = params;
    const i = getSafeIndex(params, item); // 👈 kritik
    return (
      <View>
        <Row item={item} drag={drag} isActive={isActive} i={i} />
        {!isLast(i) && <InsertBar index={i + 1} />}
      </View>
    );
  };

  const listRef = useRef(null);

  const ListBody = DraggableFlatList && USE_DRAGGABLE ? DraggableFlatList : FlatList;

  const commonListProps = {
    data: stops,
    keyExtractor: (s, idx) => (s && s.id) ? s.id : `stop-${idx}`,
    renderItem,
    contentContainerStyle: styles.list,
    keyboardShouldPersistTaps: 'handled',
  };

  const draggableProps = DraggableFlatList && USE_DRAGGABLE ? {
    activationDistance: Platform.select({ ios: 12, android: 4 }),
    autoscrollThreshold: 40,
    autoscrollSpeed: 50,
    onDragBegin: (index) => dlog('onDragBegin', index),
    // Sınırların dışına bırakmayı engelle: 1..len-2’ye klampla
    onDragEnd: ({ from, to }) => {
      dlog('onDragEnd', { from, to });
      const min = 1;
      const max = stops.length - 2;
      const clamped = Math.max(min, Math.min(max, to));
      moveStop(from, clamped);
    },
    // Görsel placeholder izleme (bilgi amaçlı)
    onPlaceholderIndexChange: (pi) => {
      const min = 1, max = stops.length - 2;
      const inside = pi >= min && pi <= max;
      dlog('onPlaceholderIndexChange', { pi, allowed: inside });
    },
    ref: listRef,
    scrollEnabled: true,
  } : {};

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Rota Planla</Text>
      <Text style={styles.subtitle}>Duraklarını belirle ve rotanı oluştur</Text>

      <View style={styles.sheetDark}>
        <ListBody {...commonListProps} {...draggableProps} />
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={createRoute}>
        <Text style={styles.primaryText}>Rota Oluştur</Text>
      </TouchableOpacity>

      {/* Debug küçük özet */}
      {DEBUG ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: '#9aa4b2', fontSize: 11 }}>
            debug → from: {from?.coords ? 'ok' : 'null'}
            {'  '}| to: {to?.coords ? 'ok' : (to?.name ? 'waiting-coords' : 'empty')}
            {'  '}| wps: {waypoints.length}
          </Text>
        </View>
      ) : null}

      {/* 🔎 Durak seçme overlay’i */}
      <PlacePickerOverlay
        visible={pickerVisible}
        onClose={closePicker}
        onPick={applyPickedPlace}
        placeholder="Durak ara (ör. Ankara, Anıtkabir)"
      />
    </View>
  );
}

/* -------------------- styles -------------------- */
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#23262F',
    marginTop: 8,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#A8A8B3', fontSize: 13, marginTop: 4, marginBottom: 10 },

  sheetDark: {
    maxHeight: 360,
    backgroundColor: '#14161c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2d36',
    overflow: 'hidden',
    marginBottom: 12,
  },
  list: { paddingHorizontal: 10, paddingVertical: 8 },

  insertBar: {
    borderWidth: 1,
    borderColor: '#304d30',
    backgroundColor: '#132013',
    borderStyle: 'dashed',
    paddingVertical: 8,
    borderRadius: 10,
    marginVertical: 6,
    alignItems: 'center',
  },
  insertText: { fontSize: 12, fontWeight: '700', color: '#86efac' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161a22',
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#1f2330',
  },
  rowActive: { backgroundColor: '#101826', borderColor: '#26324a' },

  dragHandle: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1c2030', marginRight: 10,
    borderWidth: 1, borderColor: '#242a3a',
  },
  dragIcon: { fontSize: 18, color: '#94a3b8' },

  rowCenter: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#E7ECF3' },
  rowSub: { marginTop: 2, fontSize: 12, color: '#94a3b8' },

  badgeWrap: { flexDirection: 'row', gap: 6 },
  badge: {
    fontSize: 11, fontWeight: '700',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  badgeStart: { backgroundColor: '#0f2d1b', color: '#34d399' },
  badgeEnd:   { backgroundColor: '#0b2640', color: '#60a5fa' },

  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniBtn: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1,
  },
  replaceBtn: { backgroundColor: '#0b2640', borderColor: '#1e3a5f' },
  delBtn: { backgroundColor: '#2a1212', borderColor: '#3b1f1f' },

  miniTxt: { fontSize: 12, fontWeight: '700', color: '#E7ECF3' },
  delTxt: { color: '#fca5a5' },

  primaryBtn: {
    backgroundColor: '#3478F6',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  /* Overlay */
  overlayFull: { flex: 1, backgroundColor: '#0f1117' },
  overlayTopBar: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#23262F',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInputTop: {
    flex: 1,
    backgroundColor: '#151922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2d36',
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 10, android: 8 }),
    color: '#e6ebf2',
    fontSize: 15,
  },
  overlayCloseTop: { color: '#9aa4b2', fontSize: 13, fontWeight: '700' },

  loadingRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  loadingTxt: { color: '#c6cfdd', fontSize: 13 },

  historyTitle: { color: '#9aa4b2', fontSize: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  emptyTxt: { color: '#6b7280', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },

  suggestRow: { paddingHorizontal: 16, paddingVertical: 10 },
  suggestTitle: { color: '#e7ecf3', fontSize: 14, fontWeight: '700' },
  suggestSub: { color: '#9aa4b2', fontSize: 12, marginTop: 2 },

  sep: { height: 1, backgroundColor: '#1a1d26', marginHorizontal: 16 },
});
