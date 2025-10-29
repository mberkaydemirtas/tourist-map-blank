// trips/components/TripRouteSheet.js
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getModeSummaries } from '../services/RouteDirectionService';

const C = {
  card: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fg2: '#6B7280',
  primary: '#111827',
  rowBg: '#F8FAFC',
  rowActive: '#EEF2FF',
};

/* ----------------------- Küçük yardımcılar ----------------------- */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Sıra numarası çıkar: order → idx → sequence (hiçbiri yoksa null) */
const pickOrder = (obj) => {
  if (!obj) return null;
  return (
    num(obj.order) ??
    num(obj.idx) ??
    num(obj.sequence) ??
    null
  );
};

/** {lat,lon}/{lat,lng}/{coords...} → {lat,lng} */
function toLatLng(p) {
  if (!p) return null;
  const lat =
    num(p.lat) ??
    num(p.latitude) ??
    num(p?.location?.lat) ??
    num(p?.location?.latitude);
  const lng =
    num(p.lng) ??
    num(p.lon) ??
    num(p.longitude) ??
    num(p?.location?.lng) ??
    num(p?.location?.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

/** leg → waypoints (start, end) */
function waypointsFromLeg(leg) {
  if (!leg?.from?.loc || !leg?.to?.loc) return null;
  const a = toLatLng(leg.from.loc);
  const b = toLatLng(leg.to.loc);
  if (!a || !b) return null;
  return [a, b];
}

export default function TripRouteSheet({
  visible,
  leg,                // { from:{loc:{lat,lon}, order? idx? sequence? , kind?}, to:{...} }
  waypoints,          // [{lat,lng} | {place_id}] (opsiyonel – leg yoksa kullan)
  apiKey,
  onClose,
  onStart,            // (payload) => void  payload: { mode, leg, waypoints, summary, orders? }
  preferredMode = 'driving',
  legLabel = '',
  previewTitle,
}) {
  const a = useRef(new Animated.Value(0)).current;
  const [summ, setSumm] = useState({ driving: null, walking: null, transit: null });
  const [loading, setLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState(preferredMode);

  // final waypoints: leg öncelikli
  const finalWaypoints = useMemo(() => {
    const fromLeg = waypointsFromLeg(leg);
    return fromLeg || waypoints || null;
  }, [leg, waypoints]);

  // 🔢 Durak numaraları — hiçbir +1 / fallback yok
  const fromOrder = useMemo(() => pickOrder(leg?.from), [leg?.from]);
  const toOrder   = useMemo(() => pickOrder(leg?.to),   [leg?.to]);

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 130,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => { setSelectedMode(preferredMode); }, [preferredMode]);

  // Özetleri getir
  useEffect(() => {
    let ok = true;
    if (!visible) return;
    if (!finalWaypoints || finalWaypoints.length < 2) {
      setSumm({ driving: null, walking: null, transit: null });
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const res = await getModeSummaries({ waypoints: finalWaypoints, apiKey });
        if (ok) setSumm(res);
      } catch {
        if (ok) setSumm({ driving: null, walking: null, transit: null });
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => { ok = false; };
  }, [visible, apiKey, JSON.stringify(finalWaypoints)]);

  if (!visible) return null;

  const t = {
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
    opacity: a,
  };
  const anySumm = summ.driving || summ.walking || summ.transit;
  const totalDistanceText =
    summ.driving?.distanceText || summ.walking?.distanceText || summ.transit?.distanceText || '—';

  const Row = ({ icon, label, value, mode, disabled }) => {
    const active = selectedMode === mode;
    return (
      <Pressable
        onPress={() => !disabled && setSelectedMode(mode)}
        style={[
          styles.row,
          active && { backgroundColor: C.rowActive, borderColor: '#C7D2FE' },
          disabled && { opacity: 0.5 },
        ]}
        accessibilityRole="button"
        disabled={disabled}
      >
        <Text style={styles.rowIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowVal}>{value || (disabled ? '—' : (loading ? '...' : '—'))}</Text>
      </Pressable>
    );
  };

  const handleStart = () => {
    if (!onStart) return;
    const summary =
      (selectedMode === 'walking' && summ.walking) ? summ.walking :
      (selectedMode === 'transit'  && summ.transit) ? summ.transit :
      summ.driving || null;

    onStart({
      mode: selectedMode,
      leg: leg || null,
      waypoints: finalWaypoints || null,
      summary, // { distanceText, durationText, ... }
      // 🔢 NavigationScreen’de rozetler için net sıra numaraları
      orders: (fromOrder != null || toOrder != null) ? { from: fromOrder, to: toOrder } : null,
    });
  };

  // Başlık ve alt bilgi — previewTitle → legLabel → “Rota Özeti”
  const titleText = previewTitle || legLabel || 'Rota Özeti';
  const minorLine =
    previewTitle && legLabel
      ? legLabel
      : (fromOrder != null || toOrder != null)
      ? `Durak: ${fromOrder != null ? `#${fromOrder}` : '—'} → ${toOrder != null ? `#${toOrder}` : '—'}`
      : '';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: 10 }}>
        <Animated.View style={[styles.card, t]} pointerEvents="auto">
          <View style={styles.top}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.title}>{titleText}</Text>
              {!!minorLine && <Text numberOfLines={1} style={styles.metaMinor}>{minorLine}</Text>}
            </View>
            <Pressable onPress={onClose} style={styles.x} hitSlop={8} accessibilityLabel="Kapat">
              <Ionicons name="close" size={18} color={C.fg} />
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.meta}>Toplam mesafe: {totalDistanceText}</Text>
            {loading && (
              <View style={{ marginLeft: 8 }}>
                <ActivityIndicator size="small" />
              </View>
            )}
          </View>

          <View style={{ marginTop: 8 }}>
            <Row icon="🚗" label="Arabayla"       mode="driving" disabled={!summ.driving} value={summ.driving?.durationText} />
            <Row icon="🚶" label="Yürüyerek"      mode="walking" disabled={!summ.walking} value={summ.walking?.durationText} />
            <Row icon="🚌" label="Toplu taşımayla" mode="transit" disabled={!summ.transit} value={summ.transit?.durationText} />
          </View>

          <View style={styles.actions}>
            <Pressable onPress={handleStart} disabled={false} style={styles.primary}>
              <Ionicons name="navigate" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={{ color: '#fff', fontWeight: '800' }}>
                {selectedMode === 'walking' ? 'Yürüyerek başlat'
                  : selectedMode === 'transit' ? 'Toplu taşımayla başlat'
                  : 'Arabayla başlat'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '96%', maxWidth: 640, backgroundColor: C.card, borderRadius: 14,
    padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: .12, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  title: { color: C.fg, fontWeight: '800', fontSize: 16 },
  metaMinor: { color: C.fg2, fontSize: 12, marginTop: 2 },

  x: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },

  metaRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center' },
  meta: { color: C.fg2 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: 10, backgroundColor: C.rowBg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
    marginTop: 8,
  },
  rowIcon: { width: 22, textAlign: 'center', fontSize: 16 },
  rowLabel: { flex: 1, marginLeft: 8, fontWeight: '700', color: C.fg },
  rowVal: { color: C.fg2, fontWeight: '700' },

  actions: { marginTop: 12, alignItems: 'flex-end' },
  primary: { backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
});
