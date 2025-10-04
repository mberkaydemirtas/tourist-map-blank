// trips/screens/TripPlansScreen.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions, ActivityIndicator, Alert,
  BackHandler, LayoutAnimation, Platform, UIManager, ScrollView, TouchableOpacity
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SideTimeline from '../components/SideTimeline';
import { generatePlan, reoptimizeDay } from '../services/planService';
import { getTripLocal, patchTripLocal } from '../../app/lib/tripsLocal';
import { getPlanByTripId, savePlan } from '../shared/plansRepo';
import { formatDate } from '../shared/types';
import { resolvePlacesBatch } from '../services/placeResolver';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const LEFT_OPEN_W = Math.min(380, SCREEN_W * 0.42);
const LEFT_CLOSED_W = 52;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---------------- helpers (eşleştirme anahtarı ve yer listesi) ---------------- */
const round5 = (x) => Math.round(Number(x) * 1e-0) / 1e-0; // plan tarafında sadece string key için kullanılacak
const round5k = (x) => Math.round(Number(x) * 1e5) / 1e5;  // seed-uyumlu (placeResolver ile aynı)
const keyOf = (x) => {
  const lat = Number(x?.lat ?? x?.coords?.lat);
  const lon = Number(x?.lon ?? x?.coords?.lng ?? x?.coords?.lon);
  const nm  = String(x?.name || '').trim().toLowerCase();
  return `${nm}@${round5k(lat)},${round5k(lon)}`;
};
function getPlacesArray(trip) {
  return Array.isArray(trip?.places) && trip.places.length
    ? trip.places
    : (Array.isArray(trip?.selectedPlaces) ? trip.selectedPlaces : []);
}
function cityNameOfTrip(trip) {
  if (Array.isArray(trip?.cities) && trip.cities.length) return trip.cities[0];
  const wa = trip?._whereAnswer;
  if (wa?.mode === 'single') return wa?.single?.city?.name || '';
  return '';
}

/**
 * Plan üretiminden önce güvenlik katmanı:
 * - place_id olmayan (ama name + coords olan) yerler için resolvePlacesBatch çalıştırır,
 * - cache’te varsa g_lat/g_lon alır, yoksa Google fallback ile eşleştirir,
 * - trip içindeki kayda Google koordinatlarını (coords/lat/lon) yazar,
 * - final trip döner (değişim varsa local’e patch’ler).
 */
async function ensureResolvedForPlan(trip) {
  if (!trip) return trip;
  const sourceField =
    Array.isArray(trip?.places) && trip.places.length ? 'places'
    : (Array.isArray(trip?.selectedPlaces) ? 'selectedPlaces' : 'places');

  const all = getPlacesArray(trip);
  if (!all.length) return trip;

  const unresolved = all.filter(p => {
    if (p?.place_id) return false;
    const lat = Number(p?.lat ?? p?.coords?.lat);
    const lon = Number(p?.lon ?? p?.coords?.lng ?? p?.coords?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && (p?.name || '').trim().length > 0;
  });

  if (!unresolved.length) return trip;

  const city = cityNameOfTrip(trip) || '';
  let batch = [];
  try {
    batch = await resolvePlacesBatch({ items: unresolved, city });
  } catch (e) {
    // eşleştirme hatası olsa bile planı varsa üretelim (eldeki coords ile)
    return trip;
  }

  const byKey = new Map(batch.map(x => [keyOf(x), x]));
  let changed = false;

  const merged = all.map(old => {
    if (old?.place_id) return old;
    const nn = byKey.get(keyOf(old));
    if (nn?.place_id) {
      const gLat = Number(nn?.coords?.lat ?? nn?.lat);
      const gLon = Number(nn?.coords?.lng ?? nn?.lon);
      const coordsNew = (Number.isFinite(gLat) && Number.isFinite(gLon))
        ? { lat: gLat, lng: gLon }
        : (old.coords || null);

      changed = true;
      return {
        ...old,
        place_id: nn.place_id,
        resolved: true,
        coords: coordsNew || old.coords || null,
        lat: coordsNew?.lat ?? old.lat,
        lon: coordsNew?.lng ?? old.lon,
        opening_hours: nn.opening_hours ?? old.opening_hours ?? null,
        rating: nn.rating ?? old.rating ?? null,
        user_ratings_total: nn.user_ratings_total ?? old.user_ratings_total ?? null,
        price_level: nn.price_level ?? old.price_level ?? null,
        _matched: true,
      };
    }
    return old;
  });

  if (!changed) return trip;

  const key = trip._id ?? trip.id;
  const patched = {
    ...(trip || {}),
    [sourceField]: merged,
    updatedAt: new Date().toISOString(),
    __dirty: true,
  };
  try {
    if (key) await patchTripLocal(key, { [sourceField]: merged, updatedAt: patched.updatedAt, __dirty: true });
  } catch {}
  return patched;
}

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const prefs = useMemo(() => ({
    dayStart: '09:30',
    dayEnd: '20:00',
    lunchAround: '13:00',
    dinnerAround: '19:00',
    defaultDurations: { museum: 90, sights: 45, restaurants: 60, cafes: 40, parks: 40, bars: 75 },
    tempo: 'normal',
    travelMode: 'driving',  // isterseniz trip?.travelMode ile senkronlayabilirsiniz
    mealSearchRadiusMeters: 1200,
    minRating: 4.2,
  }), []);

  useEffect(() => {
    const onBack = () => { navigation.navigate('TripsHome'); return true; };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      const t = e.data?.action?.type;
      if (t !== 'GO_BACK' && t !== 'POP') return;
      const routes = navigation.getState()?.routes || [];
      const hasHomeBelow = routes.some((r, i) => r.name === 'TripsHome' && i < routes.length - 1);
      if (hasHomeBelow) return;
      e.preventDefault();
      navigation.navigate('TripsHome');
    });
    return sub;
  }, [navigation]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // 1) Trip’i al
        let t = await getTripLocal(tripId);
        if (!t) { Alert.alert('Plan', 'Trip bulunamadı.'); setLoading(false); return; }

        // 2) Plan öncesi güvence: eşleşmeyeni eşleştir, Google koordinatlarını trip’e yaz
        t = await ensureResolvedForPlan(t);
        setTrip(t);

        // 3) Var olan planı al; yoksa üret & kaydet
        const existing = await getPlanByTripId(tripId);
        if (existing?.days?.length) {
          setPlan(existing);
        } else {
          let p = await generatePlan(t, prefs, { useRealDirections: true });
          p = { ...p, tripId: t._id, _id: p._id ?? p.id ?? `plan_${t._id}`, id: p.id ?? p._id ?? `plan_${t._id}` };
          await savePlan(p);
          setPlan(p);
        }
      } catch (e) {
        console.warn('[TripPlansScreen] load error', e);
        Alert.alert('Plan', 'Plan hazırlanırken hata oluştu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, prefs]);

  const day = useMemo(() => plan?.days?.[dayIndex] || null, [plan, dayIndex]);

  const onTogglePanel = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsPanelOpen((s) => !s);
  }, []);

  const goReview = useCallback(() => {
    navigation.navigate('TripReview', { tripId });
  }, [navigation, tripId]);

  const leftW = isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W;

  const markers = useMemo(() => {
    if (!day) return [];
    return day.activities
      .filter(a => a?.place?.location && Number.isFinite(a.place.location.lat) && Number.isFinite(a.place.location.lon))
      .map((a, idx) => ({
        key: a.id || String(idx),
        coordinate: { latitude: a.place.location.lat, longitude: a.place.location.lon },
        title: a.place.name || a.label,
        color: a.type === 'meal' ? '#4CAF50' : (a.type === 'transfer' ? '#607D8B' : '#2196F3'),
      }));
  }, [day]);

  const polylineCoords = useMemo(() => {
    const poly = day?.route?.polyline;
    if (!poly || !poly.length) return null;
    return poly.map(p => ({ latitude: p.lat, longitude: p.lon }));
  }, [day]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ color: '#ddd', marginTop: 8 }}>Plan hazırlanıyor…</Text>
      </View>
    );
  }
  if (!trip || !plan) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ddd' }}>Plan bulunamadı.</Text>
      </View>
    );
  }

  // Header meta
  const cityLabel = Array.isArray(trip?.cities) && trip.cities.length
    ? trip.cities.join(' • ')
    : (trip?.title || 'Gezi Planı');

  const dateLabel = trip?.dateRange?.start && trip?.dateRange?.end
    ? `${formatDate(trip.dateRange.start)} – ${formatDate(trip.dateRange.end)}`
    : '';

  return (
    <View style={styles.screen}>
      {/* Üst Header (geri + şehir + tarih + Yeniden Planla) */}
      <View style={[
        styles.header,
        { paddingTop: insets.top, minHeight: 56 + insets.top }
      ]}>
        <TouchableOpacity
          onPress={() => navigation.navigate('TripsHome')}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#111827" />
        </TouchableOpacity>

        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.headerCity} numberOfLines={1}>{cityLabel}</Text>
          {!!dateLabel && <Text style={styles.headerDates} numberOfLines={1}>{dateLabel}</Text>}
        </View>

        <TouchableOpacity onPress={goReview} style={styles.replanBtnHeader}>
          <Ionicons name="chevron-forward" size={16} color="#111827" style={{ marginRight: 6 }} />
          <Text style={styles.replanText}>Yeniden Planla</Text>
        </TouchableOpacity>
      </View>

      {/* Gün şeridi */}
      <View style={styles.daysBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
          {plan.days.map((d, i) => {
            const active = i === dayIndex;
            return (
              <Pressable
                key={d.date || i}
                onPress={() => setDayIndex(i)}
                style={[styles.dayChip, active && styles.dayChipActive]}
              >
                <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                  {`Gün ${i + 1}`} • {formatDate(d.date)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* İçerik alanı: Sol panel + Harita */}
      <View style={styles.content}>
        {/* Sol Panel */}
        <View style={[styles.side, { width: leftW }]}>
          <SideTimeline
            isOpen={isPanelOpen}
            plan={plan}
            dayIndex={dayIndex}
            showDayPicker={false}
            showToggle={false}
          />
        </View>

        {/* Toggle overlay */}
        <View pointerEvents="box-none" style={styles.toggleOverlay}>
          <Pressable
            onPress={onTogglePanel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.panelToggle,
              { left: (isPanelOpen ? leftW : LEFT_CLOSED_W) - 18 }
            ]}
          >
            <Ionicons
              name={isPanelOpen ? 'chevron-back' : 'chevron-forward'}
              size={18}
              color="#000"
            />
          </Pressable>
        </View>

        {/* Harita */}
        <View style={[styles.mapWrap, { width: SCREEN_W - leftW }]}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude:  markers?.[0]?.coordinate?.latitude  || 39.93,
              longitude: markers?.[0]?.coordinate?.longitude || 32.86,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            }}
          >
            {polylineCoords && <Polyline coordinates={polylineCoords} strokeWidth={5} />}
            {markers.map(m => (
              <Marker key={m.key} coordinate={m.coordinate} title={m.title} pinColor={m.color} />
            ))}
          </MapView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6' },

  header: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6', marginRight: 8,
  },
  headerCity: { color: '#111827', fontSize: 16, fontWeight: '800', lineHeight: 20 },
  headerDates: { color: '#6B7280', fontSize: 12, marginTop: 2 },

  replanBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  replanText: { color: '#111827', fontWeight: '800' },

  daysBar: {
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    marginRight: 8,
  },
  dayChipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  dayChipText: { color: '#111827', fontWeight: '700', fontSize: 12 },
  dayChipTextActive: { color: '#FFFFFF' },

  content: { flex: 1, flexDirection: 'row', position: 'relative' },

  side: {
    backgroundColor: '#FFFFFF',
    borderRightWidth: 0,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  toggleOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
  },
  panelToggle: {
    position: 'absolute',
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },

  mapWrap: { backgroundColor: '#EEF2F7' },
  map: { flex: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0D12' },
});
