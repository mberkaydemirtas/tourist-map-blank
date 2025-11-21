// /trips/components/TripRouteSheet.js
import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
} from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MODES = ['driving', 'transit', 'walking'];

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];

  let index = 0;
  const len = encoded.length;
  const path = [];
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    result = 0;
    shift = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    path.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }
  return path;
}

// Basit haversine (metre)
function haversineMeters(p1, p2) {
  const R = 6371000; // metre
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);
  const dLat = lat2 - lat1;
  const dLon = toRad(p2.lng - p1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildTextsFromDistanceAndMode(totalDistanceMeters, mode) {
  const distanceKm = totalDistanceMeters / 1000;
  const distanceText =
    distanceKm < 1
      ? `${(distanceKm * 1000).toFixed(0)} m`
      : `${distanceKm.toFixed(1)} km`;

  let speedKmh = 45; // driving default
  if (mode === 'walking') speedKmh = 5;
  else if (mode === 'transit') speedKmh = 25;

  const durationHours = distanceKm / speedKmh;
  const totalMinutes = durationHours * 60;
  const durationText =
    totalMinutes < 60
      ? `${Math.round(totalMinutes)} dk`
      : `${Math.floor(totalMinutes / 60)} sa ${Math.round(
          totalMinutes % 60
        )} dk`;

  return { distanceText, durationText };
}

// Transit adımlarını sadeleştir
function extractTransitStepsFromJson(json) {
  const out = [];
  if (!json?.routes?.[0]?.legs) return out;
  const legs = json.routes[0].legs;

  legs.forEach((lg, legIdx) => {
    (lg.steps || []).forEach((st, stepIdx) => {
      const td = st.transit_details;
      if (td) {
        out.push({
          key: `${legIdx}-${stepIdx}`,
          travelMode: st.travel_mode,
          lineName:
            td.line?.short_name ||
            td.line?.name ||
            td.line?.vehicle?.name ||
            '',
          vehicleType: td.line?.vehicle?.type || '',
          from: td.departure_stop?.name || '',
          to: td.arrival_stop?.name || '',
          numStops: td.num_stops,
          departureTime: td.departure_time?.text || '',
          arrivalTime: td.arrival_time?.text || '',
        });
      }
    });
  });

  return out;
}

export default function TripRouteSheet({
  visible,
  waypoints,          // [{ lat, lng } veya { latitude, longitude }]
  apiKey,
  preferredMode = 'driving',
  previewData,        // routeData (parent)
  legLabel,
  previewTitle,
  onClose,
  onStart,
  onRouteData,        // (routeObj) => setRouteData(routeObj)
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(preferredMode || 'driving');
  const [loading, setLoading] = useState(false);
  const [localRoute, setLocalRoute] = useState(null);

  // onRouteData için ref → dependency’den çıkartıyoruz, sonsuz döngüyü kırmak için
  const onRouteDataRef = useRef(onRouteData);
  useEffect(() => {
    onRouteDataRef.current = onRouteData;
  }, [onRouteData]);

  // drag animasyonu
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        Math.abs(gestureState.dy) > 10 && gestureState.dy > 0,
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy > 80) {
          Animated.timing(translateY, {
            toValue: 300,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            onClose?.();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const waypointsKey = useMemo(() => {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return '';
    try {
      return JSON.stringify(
        waypoints.map((w) => ({
          lat: Number(w.lat ?? w.latitude),
          lng: Number(w.lng ?? w.lon ?? w.longitude),
        }))
      );
    } catch {
      return '';
    }
  }, [waypoints]);

  const hasWaypoints = useMemo(
    () => Array.isArray(waypoints) && waypoints.length >= 2,
    [waypoints]
  );

  const title = useMemo(() => {
    const t = (previewTitle || '').trim();
    if (t) return t;
    const l = (legLabel || '').trim();
    if (l) return l;
    return 'Rota';
  }, [previewTitle, legLabel]);

  const modeLabel = (m) => {
    if (m === 'driving') return 'Araba';
    if (m === 'transit') return 'Toplu taşıma';
    if (m === 'walking') return 'Yürüme';
    return m;
  };

  // Sheet içinden gelen rota (localRoute) varsa onu kullan, yoksa parent previewData
  const activeRoute = localRoute || previewData || null;
  const activeDistance = activeRoute?.distanceText || '';
  const activeDuration = activeRoute?.durationText || '';
  const activeTransitSteps =
    mode === 'transit' ? activeRoute?.transitSteps || [] : [];

  // Rota fetch eden efekt – onRouteData dependency’den ÇIKTI!
  useEffect(() => {
    if (!visible) return;
    if (!hasWaypoints || !waypointsKey) return;

    let cancelled = false;

    async function fetchRoute() {
      setLoading(true);
      setLocalRoute(null);

      let pts;
      try {
        pts = JSON.parse(waypointsKey);
      } catch {
        setLoading(false);
        return;
      }

      if (!Array.isArray(pts) || pts.length < 2) {
        setLoading(false);
        return;
      }

      const origin = pts[0];
      const destination = pts[pts.length - 1];
      const middle = pts.slice(1, pts.length - 1);

      const buildFallbackRoute = () => {
        let totalDist = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          totalDist += haversineMeters(pts[i], pts[i + 1]);
        }
        if (totalDist <= 0) {
          totalDist = haversineMeters(origin, destination);
        }

        const { distanceText, durationText } =
          buildTextsFromDistanceAndMode(totalDist, mode);

        const fallbackPolylineCoords = pts.map((p) => ({
          latitude: p.lat,
          longitude: p.lng,
        }));

        const fallbackRouteObj = {
          mode,
          waypoints: pts,
          distanceText,
          durationText,
          polylineCoords: fallbackPolylineCoords,
          raw: null,
          fallback: true,
          transitSteps: [],
        };

        setLocalRoute(fallbackRouteObj);
        onRouteDataRef.current?.(fallbackRouteObj);
      };

      // API key yoksa → direkt fallback
      if (!apiKey) {
        buildFallbackRoute();
        setLoading(false);
        return;
      }

      try {
        const originStr = `${origin.lat},${origin.lng}`;
        const destStr = `${destination.lat},${destination.lng}`;
        const wpStr = middle
          .map((p) => `${p.lat},${p.lng}`)
          .join('|');

        const params = new URLSearchParams();
        params.append('origin', originStr);
        params.append('destination', destStr);
        params.append('mode', mode);
        params.append('key', apiKey);
        if (wpStr) params.append('waypoints', wpStr);

        const url =
          'https://maps.googleapis.com/maps/api/directions/json?' +
          params.toString();

        const res = await fetch(url);
        const json = await res.json();

        if (cancelled) return;

        if (json.status !== 'OK' || !json.routes || !json.routes[0]) {
          console.warn(
            'Directions error',
            json.status,
            json.error_message
          );
          buildFallbackRoute();
          setLoading(false);
          return;
        }

        const route = json.routes[0];

        let totalDuration = 0; // saniye
        let totalDistance = 0; // metre
        const legs = route.legs || [];

        legs.forEach((lg) => {
          if (lg.duration?.value != null)
            totalDuration += lg.duration.value;
          if (lg.distance?.value != null)
            totalDistance += lg.distance.value;
        });

        if (totalDistance <= 0) {
          for (let i = 0; i < pts.length - 1; i++) {
            totalDistance += haversineMeters(
              pts[i],
              pts[i + 1]
            );
          }
        }
        if (totalDistance <= 0) {
          totalDistance = haversineMeters(origin, destination);
        }

        if (totalDuration <= 0 && totalDistance > 0) {
          const distanceKm = totalDistance / 1000;
          let speedKmh = 45;
          if (mode === 'walking') speedKmh = 5;
          else if (mode === 'transit') speedKmh = 25;
          const durationHours = distanceKm / speedKmh;
          totalDuration = durationHours * 3600;
        }

        const durationMin = totalDuration / 60;
        const distanceKm = totalDistance / 1000;

        const durationText =
          durationMin < 60
            ? `${Math.round(durationMin)} dk`
            : `${Math.floor(durationMin / 60)} sa ${Math.round(
                durationMin % 60
              )} dk`;

        const distanceText =
          distanceKm < 1
            ? `${(distanceKm * 1000).toFixed(0)} m`
            : `${distanceKm.toFixed(1)} km`;

        const polylineStr = route.overview_polyline?.points;
        const polylineCoords = polylineStr
          ? decodePolyline(polylineStr)
          : pts.map((p) => ({
              latitude: p.lat,
              longitude: p.lng,
            }));

        const transitSteps =
          mode === 'transit'
            ? extractTransitStepsFromJson(json)
            : [];

        const routeObj = {
          mode,
          waypoints: pts,
          distanceText,
          durationText,
          polylineCoords,
          raw: json,
          fallback: false,
          transitSteps,
        };

        setLocalRoute(routeObj);
        onRouteDataRef.current?.(routeObj);
        setLoading(false);
      } catch (err) {
        console.warn('Directions fetch error', err);
        if (cancelled) return;
        buildFallbackRoute();
        setLoading(false);
      }
    }

    fetchRoute();

    return () => {
      cancelled = true;
    };
    // ⚠️ onRouteData dependency’de YOK → sonsuz döngü kırıldı
  }, [visible, apiKey, mode, waypointsKey, hasWaypoints]);

  if (!visible) return null;

  const canStart =
    !!onStart && !!activeRoute && !!hasWaypoints;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* arka plan harita kayabilsin diye sadece card pointerEvents=auto */}
      <Animated.View
        style={[
          styles.card,
          {
            transform: [{ translateY }],
            paddingBottom: 16 + insets.bottom, // 🔥 BUTONU SAFE AREA ÜSTÜNE ÇEK
          },
        ]}
        pointerEvents="auto"
        {...panResponder.panHandlers}
      >
        {/* drag handle */}
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        {/* Başlık */}
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {!!legLabel && legLabel !== title && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {legLabel}
          </Text>
        )}

        {/* Mod seçici */}
        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const selected = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[
                  styles.modeChip,
                  selected && styles.modeChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    selected && styles.modeChipTextSelected,
                  ]}
                >
                  {modeLabel(m)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Süre & mesafe */}
        <View style={styles.infoRow}>
          {loading ? (
            <View style={styles.infoBlock}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <ActivityIndicator
                  size="small"
                  color="#F9FAFB"
                />
                <Text
                  style={[styles.infoMain, { marginLeft: 8 }]}
                >
                  Rota yükleniyor...
                </Text>
              </View>
            </View>
          ) : hasWaypoints &&
            (activeDistance || activeDuration) ? (
            <View style={styles.infoBlock}>
              <Text style={styles.infoMain} numberOfLines={1}>
                {activeDuration || '—'}
                {activeDistance ? ' • ' : ''}
                {activeDistance || ''}
              </Text>
              <Text style={styles.infoLabel}>
                {modeLabel(mode)} ile tahmini süre
                ve mesafe
              </Text>
            </View>
          ) : hasWaypoints ? (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>
                Rota bilgisi bulunamadı. Haritada çizilen rota
                yine de gösteriliyor olabilir.
              </Text>
            </View>
          ) : (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>
                Rota için yeterli nokta yok.
              </Text>
            </View>
          )}
        </View>

        {/* Toplu taşıma adımları (basit özet) */}
        {mode === 'transit' &&
          !loading &&
          activeTransitSteps.length > 0 && (
            <View style={styles.transitContainer}>
              <Text style={styles.transitTitle}>
                Toplu taşıma adımları
              </Text>
              <ScrollView
                style={styles.transitScroll}
                nestedScrollEnabled
              >
                {activeTransitSteps.map((st) => (
                  <View
                    key={st.key}
                    style={styles.transitStep}
                  >
                    <Text style={styles.transitLine}>
                      {st.lineName || 'Hat'}{' '}
                      {st.vehicleType
                        ? `• ${st.vehicleType}`
                        : ''}
                    </Text>
                    <Text style={styles.transitStops}>
                      {st.from || 'Başlangıç'} →{' '}
                      {st.to || 'Varış'}
                      {typeof st.numStops === 'number'
                        ? ` • ${st.numStops} durak`
                        : ''}
                    </Text>
                    {(st.departureTime || st.arrivalTime) && (
                      <Text style={styles.transitTimes}>
                        {st.departureTime
                          ? `Kalkış: ${st.departureTime}`
                          : ''}
                        {st.departureTime &&
                          st.arrivalTime &&
                          '  •  '}
                        {st.arrivalTime
                          ? `Varış: ${st.arrivalTime}`
                          : ''}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

        {/* Butonlar */}
        <View style={styles.footerRow}>
          <Pressable
            style={styles.footerBtnGhost}
            onPress={onClose}
          >
            <Ionicons
              name="close"
              size={16}
              color="#E5E7EB"
            />
            <Text style={styles.footerBtnGhostText}>
              Kapat
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.footerBtnPrimary,
              !canStart && { opacity: 0.5 },
            ]}
            disabled={!canStart}
            onPress={() => {
              if (!onStart || !activeRoute) return;
              onStart({
                mode,
                route: activeRoute,
              });
            }}
          >
            <Ionicons
              name="navigate"
              size={16}
              color="#0F172A"
            />
            <Text style={styles.footerBtnPrimaryText}>
              Navigasyona Git
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#020617',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: '#1E293B',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 16,
    maxHeight: '70%',
  },
  handleRow: {
    alignItems: 'center',
    marginBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#4B5563',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#9CA3AF',
  },
  modeRow: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  modeChip: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4B5563',
    backgroundColor: '#020617',
    marginHorizontal: 2,
    alignItems: 'center',
  },
  modeChipSelected: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  modeChipTextSelected: {
    color: '#F9FAFB',
  },
  infoRow: {
    marginTop: 12,
  },
  infoBlock: {
    minHeight: 40,
    justifyContent: 'center',
  },
  infoMain: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  infoLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#9CA3AF',
  },
  transitContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  transitTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
    marginBottom: 4,
  },
  transitScroll: {
    maxHeight: 150,
  },
  transitStep: {
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1F2937',
  },
  transitLine: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F9FAFB',
  },
  transitStops: {
    fontSize: 12,
    color: '#D1D5DB',
    marginTop: 1,
  },
  transitTimes: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  footerRow: {
    flexDirection: 'row',
    marginTop: 14,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  footerBtnGhostText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  footerBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: '#FBBF24',
    borderRadius: 999,
  },
  footerBtnPrimaryText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
});
