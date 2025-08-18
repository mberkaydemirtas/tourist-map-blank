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
  KeyboardAvoidingView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useLocation } from '../map/hooks/useLocation';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete, getPlaceDetails } from '../map/maps'; // ← projendeki yol

let DraggableFlatList = null;
const USE_DRAGGABLE = true;
try {
  DraggableFlatList = require('react-native-draggable-flatlist').default;
} catch (e) {
  DraggableFlatList = null;
}

/* -------------------- küçük yardımcılar -------------------- */
const toLatLng = (any) => {
  if (!any) return null;
  // { latitude, longitude }
  if (typeof any.latitude === 'number' && typeof any.longitude === 'number') {
    return { latitude: any.latitude, longitude: any.longitude };
  }
  // { lat, lng } (Google geometry.location)
  if (typeof any.lat === 'number' && typeof any.lng === 'number') {
    return { latitude: any.lat, longitude: any.lng };
  }
  // [lat, lng]
  if (Array.isArray(any) && any.length >= 2 && typeof any[0] === 'number' && typeof any[1] === 'number') {
    return { latitude: any[0], longitude: any[1] };
  }
  return null;
};
const makeStop = (patch = {}) => ({
  id: String(Math.random()),
  name: null,
  place_id: null,
  coords: null, // { latitude, longitude }
  // ekstra: gösterim için hafif metadata
  address: null,
  rating: null,
  user_ratings_total: null,
  ...patch,
});

const HISTORY_KEY = 'route_planner_place_history_v1';
const saveToHistory = async (item) => {
  try {
    const raw = (await AsyncStorage.getItem(HISTORY_KEY)) || '[]';
    const list = JSON.parse(raw);
    const exists = list.find((x) => x.place_id === item.place_id);
    const next = [
      {
        name: item.name,
        place_id: item.place_id,
        coords: item.coords,
        address: item.address ?? null,
        rating: item.rating ?? null,
        user_ratings_total: item.user_ratings_total ?? null,
      },
      ...(!exists ? list : list.filter((x) => x.place_id !== item.place_id)),
    ].slice(0, 10);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
};
const loadHistory = async () => {
  try {
    const raw = (await AsyncStorage.getItem(HISTORY_KEY)) || '[]';
    return JSON.parse(raw);
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
  // alt satırda gösterilecek kısa bilgi
  const parts = [];
  if (item.address) parts.push(item.address);
  if (item.rating) {
    parts.push(`${item.rating.toFixed ? item.rating.toFixed(1) : item.rating}★${item.user_ratings_total ? ` (${item.user_ratings_total})` : ''}`);
  }
  if (parts.length === 0 && item?.coords) {
    parts.push(
      `${(+item.coords.latitude).toFixed?.(5)}, ${(+item.coords.longitude).toFixed?.(5)}`
    );
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
        if (!cancelled) setSuggestions(res || []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [dq]);

  const pickPlace = async (pred) => {
    try {
      setLoading(true);
      const det = await getPlaceDetails(pred.place_id);
      const coordsRaw =
        det?.coords ??
        det?.location ??
        det?.geometry?.location ??
        null;
      const coords = toLatLng(coordsRaw);
      const item = {
        name: det?.name || pred?.structured_formatting?.main_text || pred?.description || 'Seçilen yer',
        place_id: pred.place_id,
        coords,
        address:
          det?.formatted_address ||
          det?.vicinity ||
          pred?.structured_formatting?.secondary_text ||
          null,
        rating: det?.rating ?? null,
        user_ratings_total: det?.user_ratings_total ?? null,
      };
    if (item.coords) {        
      await saveToHistory(item);
        onPick?.(item);
      }
    } catch (e) {
           onPick?.({
       name: pred?.structured_formatting?.main_text || pred?.description || 'Seçilen yer',
       place_id: pred.place_id,
       coords: null,
       address: pred?.structured_formatting?.secondary_text || null,
     });
      // noop
    } finally {
      setLoading(false);
    }
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
      onPress={() => onPick?.({ ...item, coords: toLatLng(item.coords) || item.coords })}
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
  // Üstte sabit arama barı + altında liste
  return (
        <Modal
          visible={visible}
          animationType="fade"
          transparent={false}
          statusBarTranslucent
          presentationStyle="fullScreen"
          onRequestClose={onClose}
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
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}>
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

  // Başlangıç sabit: konumunuz
  const from = useMemo(
    () => ({
      id: 'from',
      name: 'Konumunuz',
      place_id: null,
      coords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
      address: null,
      rating: null,
      user_ratings_total: null,
    }),
    [coords]
  );

  // stops = [from, ...waypoints, to]
  const [waypoints, setWaypoints] = useState([]);
  const [to, setTo] = useState(null);

  const stops = useMemo(
    () => [from, ...waypoints, to || { id: 'to-null', name: null, place_id: null, coords: null }],
    [from, waypoints, to]
  );

  const isFirst = (i) => i === 0;
  const isLast  = (i) => i === stops.length - 1;

  // ---- Overlay kontrolü ----
  const [pickerVisible, setPickerVisible] = useState(false);
  const targetIndexRef = useRef(null); // stops içindeki index

  const openPickerForIndex = (index) => {
    targetIndexRef.current = index;
    setPickerVisible(true);
  };
  const closePicker = () => {
    setPickerVisible(false);
    targetIndexRef.current = null;
  };

// Seçilen yer, tıklanan pozisyona yazılsın (insert’te de replace’te de)
 const applyPickedPlace = async (picked) => {
   // overlay’i hemen kapat (UX)
   closePicker();
   let norm = { ...picked, coords: toLatLng(picked.coords) || picked.coords }; 
   // Koordinat yoksa burada getir
   if (!norm.coords && picked?.place_id) {
     try {
       const det = await getPlaceDetails(picked.place_id);
       const coords = toLatLng(det?.coords || det?.location || det?.geometry?.location);
       norm = {
         ...norm,
         coords,
         name: norm.name || det?.name,
         address: norm.address || det?.formatted_address || det?.vicinity || null,
         rating: norm.rating ?? det?.rating ?? null,
         user_ratings_total: norm.user_ratings_total ?? det?.user_ratings_total ?? null,
       };
     } catch {}
   }
   if (!norm.coords) return; // hâlâ yoksa vazgeç

  const idx = targetIndexRef.current;
  if (idx == null) return;

  if (isLast(idx)) {
    // Bitiş
    setTo({
      id: 'to',
      name: norm.name,
      place_id: norm.place_id,
      coords: norm.coords,
      address: norm.address ?? null,
      rating: norm.rating ?? null,
      user_ratings_total: norm.user_ratings_total ?? null,
    });
  } else if (!isFirst(idx)) {
    // Waypoint – yeni eklenen boş satır da olabilir, mevcut satırı değiştirmek de olabilir
    const wpIndex = idx - 1;
    setWaypoints((prev) => {
      const arr = [...prev]; // 👈 EKSİK OLAN BUYDU
      arr[wpIndex] = {
        ...(arr[wpIndex] || makeStop()),
        name: norm.name,
        place_id: norm.place_id,
        coords: norm.coords,
        address: norm.address ?? null,
        rating: norm.rating ?? null,
        user_ratings_total: norm.user_ratings_total ?? null,
      };
      return arr;
    });
  }
};

  /* --------- ekleme/silme/yer değiştir --------- */
  const insertAt = (index) => {
    // from ve to arasına BOŞ bir waypoint satırı koy → hemen picker aç
    const wpIndex = Math.max(0, Math.min(index - 1, waypoints.length));
    setWaypoints((prev) => {
      const cp = [...prev];
      cp.splice(wpIndex, 0, makeStop());
      return cp;
    });
    // yeni eklenen satırın stops-index’i tam olarak "index"
    openPickerForIndex(index);
  };

  const deleteAt = (index) => {
    if (isFirst(index) || isLast(index)) return;
    const wpIndex = index - 1;
    setWaypoints((prev) => prev.filter((_, i) => i !== wpIndex));
  };

  const replaceAt = (index) => {
    // from dışındakiler için picker aç → ek SATIR eklemiyoruz, sadece seçilen satırı güncelleyeceğiz
    if (isFirst(index)) return;
    openPickerForIndex(index);
  };

  const moveStop = (fromIdx, toIdx) => {
    // from (0) ve to (last) taşınamaz; yalnızca 1..len-2
    const min = 1;
    const max = stops.length - 2;
    if (fromIdx < min || fromIdx > max) return;
    const clampedTo = Math.max(min, Math.min(max, toIdx));
    if (fromIdx === clampedTo) return;

    const fromWp = fromIdx - 1;
    const toWp = clampedTo - 1;

    setWaypoints((prev) => {
      const arr = [...prev];
      const it = arr.splice(fromWp, 1)[0];
      arr.splice(toWp, 0, it);
      return arr;
    });
  };

  const createRoute = () => {
    if (!from.coords || !to?.coords) {
      console.warn('Lütfen başlangıç (otomatik) ve bitiş seçin.');
      return;
    }
    const cleanWps = waypoints.filter((w) => w?.coords);
    navigation.navigate('Navigation', {
      // NavigationScreen.norm bunları direkt alacak
      from: { latitude: from.coords.latitude, longitude: from.coords.longitude },
      to:   { latitude: to.coords.latitude,   longitude: to.coords.longitude },
      // NavigationScreen’de beklenen sade waypoint formatına çevir
      waypoints: cleanWps.map(w => ({
        lat: w.coords.latitude,
        lng: w.coords.longitude,
        name: w.name,
        place_id: w.place_id,
        address: w.address,
      })),
      mode: 'driving',
      // istersen ileride kullanırız
      autoStart: true,
    });
  };

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

    // Başlık (ör: "Ankara")
    const title =
      item.name ||
      (isFirst(i) ? 'Konumunuz' : isLast(i) ? 'Bitiş seç' : `Durak ${i}`);

    // Alt satır (adres • puan)
    const sub = item?.name || item?.place_id || item?.coords ? formatDetails(item) :
      (isLast(i) ? '— bitiş seçilmedi —' : '— durak seçilmedi —');

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
              <Text style={styles.miniTxt}>{item?.name ? 'Değiştir' : 'Seç'}</Text>
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

  const keyExtractor = (s, idx) => s.id || `stop-${idx}`;

  const renderItem = (params) => {
    const { item, drag, isActive, index } = params;
    return (
      <View>
        <Row item={item} drag={drag} isActive={isActive} i={index} />
        {/* Bitişin ALTINA insert bar koymuyoruz */}
        {!isLast(index) && <InsertBar index={index + 1} />}
      </View>
    );
  };

  const ListBody = DraggableFlatList && USE_DRAGGABLE ? DraggableFlatList : FlatList;

  const listProps =
    DraggableFlatList && USE_DRAGGABLE
      ? {
          data: stops,
          keyExtractor,
          renderItem,
          contentContainerStyle: styles.list,
          activationDistance: Platform.select({ ios: 12, android: 4 }),
          autoscrollThreshold: 40,
          autoscrollSpeed: 50,
          onDragEnd: ({ from: fi, to: ti }) => moveStop(fi, ti),
          scrollEnabled: true,
          keyboardShouldPersistTaps: 'handled',
        }
      : {
          data: stops,
          keyExtractor,
          renderItem,
          contentContainerStyle: styles.list,
          scrollEnabled: true,
          keyboardShouldPersistTaps: 'handled',
        };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Rota Planla</Text>
      <Text style={styles.subtitle}>Duraklarını belirle ve rotanı oluştur</Text>

      <View style={styles.sheetDark}>
        <ListBody {...listProps} />
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={createRoute}>
        <Text style={styles.primaryText}>Rota Oluştur</Text>
      </TouchableOpacity>

      {/* 🔎 Durak seçme overlay’i – arama çubuğu yukarıda sabit */}
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
  // Kart kabuğu (dark)
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

  // İç gövde (EditStopsOverlay hissi, dark varyant)
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

  /* Overlay – tam ekran, üstte arama */
  overlayFull: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
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

  loadingRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingTxt: { color: '#c6cfdd', fontSize: 13 },

  historyTitle: { color: '#9aa4b2', fontSize: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  emptyTxt: { color: '#6b7280', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },

  suggestRow: { paddingHorizontal: 16, paddingVertical: 10 },
  suggestTitle: { color: '#e7ecf3', fontSize: 14, fontWeight: '700' },
  suggestSub: { color: '#9aa4b2', fontSize: 12, marginTop: 2 },

  sep: { height: 1, backgroundColor: '#1a1d26', marginHorizontal: 16 },
});
