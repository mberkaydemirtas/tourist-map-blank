// src/screens/NavigationScreen.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, PermissionsAndroid, Platform, TouchableOpacity, Text } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Speech from 'expo-speech';

import StepInstructionsModal from '../components/StepInstructionsModal';
import { decodePolyline, getTurnByTurnSteps, getRoute } from '../maps';

/* -------------------------- Yardımcı Fonksiyonlar -------------------------- */

// Baz konuşma (sessizliği component içinde kontrol edeceğiz)
const baseSpeak = async (text) => {
  try { Speech.stop(); Speech.speak(text, { language: 'tr-TR', pitch: 1.0, rate: 1.0 }); } catch {}
};

const metersFmt = (m) => {
  if (m == null || Number.isNaN(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 2000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(1, Math.round(m))} m`;
};

const getDistanceMeters = (c1, c2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371e3;
  const φ1 = toRad(c1.lat), φ2 = toRad(c2.lat);
  const Δφ = toRad(c2.lat - c1.lat);
  const Δλ = toRad(c2.lng - c1.lng);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getStepDistanceValue = (step) => {
  if (!step) return null;
  if (typeof step.distance === 'number') return step.distance;               // Mapbox
  if (typeof step.distance?.value === 'number') return step.distance.value; // Google
  return null;
};
const getStepDurationValue = (step) => {
  if (!step) return null;
  if (typeof step.duration === 'number') return step.duration;               // Mapbox (saniye)
  if (typeof step.duration?.value === 'number') return step.duration.value; // Google (saniye)
  return null;
};

const normalizeDeg180 = (deg) => {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

const formatInstructionTR = (step) => {
  if (!step) return '';
  const m = step.maneuver || {};
  const base =
    typeof m.instruction === 'string' && m.instruction.length > 0 ? m.instruction : '';
  const mod = (m.modifier || '').toLowerCase();
  const type = (m.type || '').toLowerCase();

  const dirMap = {
    right: 'sağa dönün',
    left: 'sola dönün',
    'slight right': 'hafif sağa dönün',
    'slight left': 'hafif sola dönün',
    'sharp right': 'keskin sağa dönün',
    'sharp left': 'keskin sola dönün',
    straight: 'düz devam edin',
    uturn: 'U dönüşü yapın',
  };
  if (type === 'arrive') return 'Varış noktasına ulaştınız';
  if (mod && dirMap[mod]) return dirMap[mod];
  return base || 'İlerle';
};

const nextPreviewText = (step) => {
  if (!step) return '';
  const t = formatInstructionTR(step);
  const d = getStepDistanceValue(step);
  return d != null ? `${t} • ${metersFmt(d)}` : t;
};

// Fallback: modifier’a göre ikon
const getModifierIcon = (step) => {
  const m = step?.maneuver || {};
  const type = (m.type || '').toLowerCase();
  const mod = (m.modifier || '').toLowerCase();

  if (type === 'arrive') return '🏁';
  if (type === 'roundabout' || type === 'rotary') return '🔁';
  if (type === 'uturn') return mod === 'right' ? '↪️' : '↩️';

  const map = {
    straight: '⬆️',
    right: '➡️',
    left: '⬅️',
    'slight right': '↗️',
    'slight left': '↖️',
    'sharp right': '↘️',
    'sharp left': '↙️',
    merge: '↗️',
    fork: '↗️',
    ramp: '↗️',
  };
  if (map[mod]) return map[mod];

  const typeMap = {
    turn: '↪️',
    new_name: '⬆️',
    continue: '⬆️',
    depart: '▶️',
    end_of_road: '⬅️',
    on_ramp: '↗️',
    off_ramp: '↘️',
  };
  return typeMap[type] || '⬆️';
};

// Heading’e göre doğru ikon
const getHeadingRelativeIcon = (headingDeg, step) => {
  const m = step?.maneuver || {};
  const type = (m.type || '').toLowerCase();
  if (type === 'arrive') return '🏁';

  const target = typeof m.bearing_after === 'number' ? m.bearing_after : null;
  if (headingDeg == null || Number.isNaN(headingDeg) || target == null) {
    return getModifierIcon(step);
  }
  const delta = normalizeDeg180(target - headingDeg);
  const ad = Math.abs(delta);
  if (ad >= 165) return delta > 0 ? '↪️' : '↩️';
  if (ad <= 15) return '⬆️';
  if (ad < 45) return delta > 0 ? '↗️' : '↖️';
  if (ad < 100) return delta > 0 ? '➡️' : '⬅️';
  return delta > 0 ? '↘️' : '↙️';
};

// Noktadan polyline’a mesafe
const toXY = (lat, lng, lat0) => {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos(lat0 * Math.PI / 180);
  return { x: lng * mPerDegLng, y: lat * mPerDegLat };
};
const pointToSegmentDist = (P, A, B, lat0) => {
  const p = toXY(P.lat, P.lng, lat0);
  const a = toXY(A.lat, A.lng, lat0);
  const b = toXY(B.lat, B.lng, lat0);
  const ABx = b.x - a.x, ABy = b.y - a.y;
  const APx = p.x - a.x, APy = p.y - a.y;
  const ab2 = ABx * ABx + ABy * ABy || 1;
  let t = (APx * ABx + APy * ABy) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * ABx, cy = a.y + t * ABy;
  return Math.hypot(p.x - cx, p.y - cy);
};
const distanceToRoute = (user, coords) => {
  if (!coords || coords.length < 2) return Infinity;
  const lat0 = user.lat;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const A = { lat: coords[i][1], lng: coords[i][0] };
    const B = { lat: coords[i + 1][1], lng: coords[i + 1][0] }; // ✅ düzeltildi
    const d = pointToSegmentDist(user, A, B, lat0);
    if (d < best) best = d;
    if (best < 5) break;
  }
  return best;
};

const formatDurationShort = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `${h} sa ${m} dk`;
  return `${m} dk`;
};

const formatETA = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const d = new Date(Date.now() + sec * 1000);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

/* --------------------------------- Ekran --------------------------------- */

export default function NavigationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { from, to, polyline, steps: initialSteps } = route.params || {};

  // ---- State / Ref ----
  const [locationPermission, setLocationPermission] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [isMapTouched, setIsMapTouched] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const [steps, setSteps] = useState(Array.isArray(initialSteps) ? initialSteps : []);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spokenFlags, setSpokenFlags] = useState({});
  const [navStarted, setNavStarted] = useState(false);
  const [distanceToManeuver, setDistanceToManeuver] = useState(null);
  const [heading, setHeading] = useState(null);

  const [isRerouting, setIsRerouting] = useState(false);
  const offRouteCountRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const lastLocRef = useRef(null);
  const hasFirstFixRef = useRef(false);

  const [dynamicRouteCoords, setDynamicRouteCoords] = useState([]);

  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const speak = useCallback((text) => { if (!mutedRef.current) baseSpeak(text); }, []);

  const baseRouteCoordinates = useMemo(() => {
    if (polyline) return decodePolyline(polyline).map((c) => [c.longitude, c.latitude]);
    if (from && to) return [[from.lng, from.lat], [to.lng, to.lat]];
    return [];
  }, [polyline, from, to]);

  const routeCoordinates = dynamicRouteCoords.length ? dynamicRouteCoords : baseRouteCoordinates;

  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);

  const stepIndexRef = useRef(currentStepIndex);
  useEffect(() => { stepIndexRef.current = currentStepIndex; }, [currentStepIndex]);

  const routeCoordsRef = useRef([]);
  useEffect(() => { routeCoordsRef.current = routeCoordinates; }, [routeCoordinates]);

  const mapCameraRef = useRef(null);

  // ---- İzin ----
  useEffect(() => {
    async function requestPermission() {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        setLocationPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        setLocationPermission(true);
      }
    }
    requestPermission();
  }, []);

  // ---- Adımları TR + bearing için Mapbox ile zenginleştir (gerekirse) ----
  useEffect(() => {
    const lacksMeta =
      Array.isArray(steps) &&
      steps.length > 0 &&
      steps[0] &&
      (!steps[0].maneuver || steps[0].maneuver.bearing_after === undefined);

    const valid = from?.lat != null && from?.lng != null && to?.lat != null && to?.lng != null;

    if (lacksMeta && valid) {
      (async () => {
        try {
          const mSteps = await getTurnByTurnSteps(from, to); // maps.js: &language=tr olmalı
          if (Array.isArray(mSteps) && mSteps.length > 0) setSteps(mSteps);
        } catch {}
      })();
    }
  }, [steps, from, to]);

  // ---- Reroute fonksiyonu ----
  const rerouteFromHere = async (userLat, userLng) => {
    if (isRerouting) return;
    const now = Date.now();
    if (now - lastRerouteAtRef.current < 15_000) return; // flood guard

    try {
      setIsRerouting(true);
      lastRerouteAtRef.current = now;
      await speak('Rota yeniden hesaplanıyor.');

      // 1) Yeni rota: Google (TR) → polyline
      const origin = { latitude: userLat, longitude: userLng };
      const destination = { latitude: to.lat, longitude: to.lng };
      const routes = await getRoute(origin, destination, 'driving');
      const primary = Array.isArray(routes) ? routes[0] : routes;
      if (!primary?.polyline) throw new Error('Yeni rota alınamadı');

      const decoded = decodePolyline(primary.polyline || '');
      const coords = decoded.map(c => [c.longitude, c.latitude]);

      // 2) Yeni adımlar: Mapbox (TR)
      const mSteps = await getTurnByTurnSteps({ lat: userLat, lng: userLng }, to);

      // 3) UI reset + güncelle
      setCurrentStepIndex(0);
      stepIndexRef.current = 0;
      setSpokenFlags({});
      setDistanceToManeuver(null);
      setSteps(Array.isArray(mSteps) && mSteps.length ? mSteps : (primary.steps || []));
      setDynamicRouteCoords(coords);
      setIsFollowing(true);
    } catch (e) {
      await speak('Rota alınamadı.');
    } finally {
      setIsRerouting(false);
    }
  };

  // ---- Konum güncellemeleri ----
  const handleUserLocation = (loc) => {
    if (!loc?.coords) return;
    const { latitude, longitude, heading: hdg } = loc.coords;
    lastLocRef.current = loc.coords;

    // İlk GPS fix geldiyse takip modunu garanti aç
    if (!hasFirstFixRef.current) {
      setIsFollowing(true);
      hasFirstFixRef.current = true;
    }

    if (typeof hdg === 'number' && !Number.isNaN(hdg) && hdg >= 0) setHeading(hdg);

    // 1) Off-route kontrolü: her zaman çalışsın
    {
      const user = { lat: latitude, lng: longitude };
      if (routeCoordsRef.current.length >= 2) {
        const dRoute = distanceToRoute(user, routeCoordsRef.current);
        const OFF_ROUTE_THRESHOLD = 30; // m
        const OFF_ROUTE_CONSEC = 2;     // ardışık update

        if (Number.isFinite(dRoute)) {
          if (dRoute > OFF_ROUTE_THRESHOLD) offRouteCountRef.current += 1;
          else offRouteCountRef.current = Math.max(0, offRouteCountRef.current - 1);

          if (offRouteCountRef.current >= OFF_ROUTE_CONSEC) {
            offRouteCountRef.current = 0;
            rerouteFromHere(latitude, longitude);
            return; // Reroute tetiklendi
          }
        }
      }
    }

    // 2) Adım/mesafe güncelle
    if (!stepsRef.current?.length) return;

    const idx = Math.min(stepIndexRef.current, stepsRef.current.length - 1);
    const step = stepsRef.current[idx];

    let target = null;
    if (Array.isArray(step?.maneuver?.location)) {
      target = { lat: step.maneuver.location[1], lng: step.maneuver.location[0] };
    }

    if (target) {
      const dist = getDistanceMeters({ lat: latitude, lng: longitude }, target);
      setDistanceToManeuver(dist);

      // Sesli uyarı eşikleri
      const stepLen = getStepDistanceValue(step) ?? 80;
      const far = Math.min(120, Math.max(60, Math.round(stepLen * 0.8)));
      const mid = Math.min(60, Math.max(25, Math.round(stepLen * 0.4)));
      const near = Math.min(25, Math.max(10, Math.round(stepLen * 0.15)));

      const key = String(idx);
      const flags = spokenFlags[key] || { far: false, mid: false, near: false, done: false };
      const directive = formatInstructionTR(step);

      if (!flags.far && dist <= far && dist > mid) {
        speak(`Yaklaşık ${metersFmt(far)} sonra ${directive}.`);
        setSpokenFlags((p) => ({ ...p, [key]: { ...flags, far: true } }));
      } else if (!flags.mid && dist <= mid && dist > near) {
        speak(`Yaklaşık ${metersFmt(mid)} sonra ${directive}.`);
        setSpokenFlags((p) => ({ ...p, [key]: { ...flags, mid: true } }));
      } else if (!flags.near && dist <= near && dist > 6) {
        speak(`Birazdan ${directive}.`);
        setSpokenFlags((p) => ({ ...p, [key]: { ...flags, near: true } }));
      }

      // Adımı geç
      if (!flags.done && dist <= 6) {
        setSpokenFlags((p) => ({ ...p, [key]: { ...flags, done: true } }));
        if (idx >= stepsRef.current.length - 1) {
          speak('Varış noktasına ulaştınız.');
          return;
        }
        const nextIndex = idx + 1;
        setCurrentStepIndex(nextIndex);
        stepIndexRef.current = nextIndex;
        const next = stepsRef.current[nextIndex];
        speak(formatInstructionTR(next));
        setDistanceToManeuver(getStepDistanceValue(next) ?? null);
      }
    } else {
      // Hedefi olmayan adım için: polyline'a mesafeyi göster
      const user = { lat: latitude, lng: longitude };
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      if (Number.isFinite(dRoute)) setDistanceToManeuver(dRoute);
    }
  };

  // ---- Kalan mesafe/süre ve ETA (alt bar) ----
  const remaining = useMemo(() => {
    if (!steps || steps.length === 0) return { dist: null, sec: null, totalSec: null };
    let dist = 0, sec = 0, totalSec = 0;
    for (let i = 0; i < steps.length; i++) {
      const d = getStepDistanceValue(steps[i]) ?? 0;
      const s = getStepDurationValue(steps[i]) ?? 0;
      totalSec += s;
      if (i >= currentStepIndex) {
        dist += d;
        sec += s;
      }
    }
    // Süre yoksa kaba tahmin (sürüş): 45 km/h ≈ 12.5 m/s
    if (sec === 0 && dist > 0) sec = Math.round(dist / 12.5);
    return { dist, sec, totalSec };
  }, [steps, currentStepIndex]);

  const etaStr = formatETA(remaining.sec);
  const remainDistStr = remaining.dist != null ? metersFmt(remaining.dist) : '—';
  const remainDurStr = formatDurationShort(remaining.sec);
  const progressPct = useMemo(() => {
    if (!remaining.totalSec || !Number.isFinite(remaining.totalSec)) return 0;
    const done = remaining.totalSec - (remaining.sec || 0);
    return Math.max(0, Math.min(100, Math.round((done / remaining.totalSec) * 100)));
  }, [remaining.sec, remaining.totalSec]);

  // ---- Steps/rota değişince reset + ilk mesafeyi anında ölç ----
  useEffect(() => {
    setCurrentStepIndex(0);
    stepIndexRef.current = 0;
    setSpokenFlags({});
    const s0 = stepsRef.current?.[0];
    const loc = lastLocRef.current;
    if (s0 && loc && Array.isArray(s0?.maneuver?.location)) {
      const target = { lat: s0.maneuver.location[1], lng: s0.maneuver.location[0] };
      const user = { lat: loc.latitude, lng: loc.longitude };
      setDistanceToManeuver(getDistanceMeters(user, target));
    } else if (loc) {
      const user = { lat: loc.latitude, lng: loc.longitude };
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      setDistanceToManeuver(Number.isFinite(dRoute) ? dRoute : null);
    } else {
      setDistanceToManeuver(null);
    }
  }, [steps, from, to, polyline]);

  // ---- Başlangıç anonsu ----
  useEffect(() => {
    if (!navStarted && steps && steps.length > 0) {
      setNavStarted(true);
      speak('Navigasyon başlatıldı.');
    }
  }, [steps, navStarted, speak]);

  const currentStep = steps?.[currentStepIndex];
  const nextStep = steps?.[currentStepIndex + 1];

  /* ---------------------------------- UI ---------------------------------- */
  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        onCameraChanged={(state) => {
          if (state?.gestures?.isGestureActive) {
            setIsMapTouched(true);
            setIsFollowing(false);
          }
        }}
        onPress={() => {
          setIsMapTouched(true);
          // takip sadece gesture ile kapanır
        }}
      >
        {locationPermission && (
          <>
            <MapboxGL.Camera
              ref={mapCameraRef}
              followUserLocation={isFollowing}
              followUserMode="course"
              followZoomLevel={17.5}
              followPitch={45}
              animationDuration={400}
            />
            <MapboxGL.UserLocation visible={true} onUpdate={handleUserLocation} />
          </>
        )}

        {from && <MapboxGL.PointAnnotation id="from" coordinate={[from.lng, from.lat]} />}
        {to && <MapboxGL.PointAnnotation id="to" coordinate={[to.lng, to.lat]} />}

        {routeCoordinates.length > 0 && (
          <MapboxGL.ShapeSource
            id="route"
            shape={{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: routeCoordinates },
            }}
          >
            <MapboxGL.LineLayer
              id="routeLine"
              style={{ lineColor: '#1E88E5', lineWidth: 6, lineOpacity: 0.9 }}
            />
          </MapboxGL.ShapeSource>
        )}
      </MapboxGL.MapView>

      {isRerouting && (
        <View style={styles.rerouteBadge}>
          <Text style={styles.rerouteText}>Rota güncelleniyor…</Text>
        </View>
      )}

      {/* Üst banner: ikon + adım + kalan */}
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.banner}
        onPress={() => {
          const instr = currentStep ? formatInstructionTR(currentStep) : 'Navigasyon';
          speak(instr);
        }}
      >
        <View style={styles.bannerRow}>
          <Text style={styles.bannerIcon}>
            {getHeadingRelativeIcon(heading, currentStep)}
          </Text>
          <Text style={styles.bannerTitle}>
            {currentStep ? formatInstructionTR(currentStep) : 'Navigasyon'}
            {distanceToManeuver != null ? ` • ${metersFmt(distanceToManeuver)}` : ''}
          </Text>
        </View>
        {!!nextStep && <Text style={styles.bannerSub}>{nextPreviewText(nextStep)}</Text>}
      </TouchableOpacity>

      {/* Alt çubuk (Google Maps tarzı) */}
      <View style={styles.bottomBar}>
        {/* ilerleme çizgisi */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.bottomInfo}>
            <Text style={styles.etaTitle}>Varış: {etaStr}</Text>
            <Text style={styles.etaSub}>{remainDistStr} • {remainDurStr}</Text>
          </View>

          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => setMuted(m => !m)}>
              <Text style={styles.actionIcon}>{muted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setIsFollowing(true);
                setIsMapTouched(false);
              }}
            >
              <Text style={styles.actionIcon}>🎯</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} onPress={() => steps?.length && setShowSteps(true)}>
              <Text style={styles.actionIcon}>📜</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.exitBtn]}
              onPress={() => {
                Speech.stop();
                navigation.goBack();
              }}
            >
              <Text style={styles.exitIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Eski hizala butonu (isteğe bağlı, alt bar zaten var) */}
      {isMapTouched && (
        <TouchableOpacity
          style={styles.alignButton}
          onPress={() => {
            setIsFollowing(true);
            setIsMapTouched(false);
          }}
        >
          <Text style={styles.alignText}>📍 Hizala</Text>
        </TouchableOpacity>
      )}

      <StepInstructionsModal visible={showSteps} steps={steps} onClose={() => setShowSteps(false)} />
    </View>
  );
}

/* --------------------------------- Styles --------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  // ÜST BANNER
  banner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 12,
    right: 12,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    elevation: 5,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center' },
  bannerIcon: { fontSize: 20, marginRight: 8 },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#111', flexShrink: 1 },
  bannerSub: { marginTop: 2, fontSize: 13, color: '#444' },

  // ALT ÇUBUK
  bottomBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: 'white',
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
    paddingHorizontal: 12,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    elevation: 12,
  },
  progressTrack: {
    height: 3, backgroundColor: '#e8e8e8', borderRadius: 2, overflow: 'hidden', marginBottom: 8,
  },
  progressFill: {
    height: 3, backgroundColor: '#1E88E5',
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottomInfo: { flexShrink: 1 },
  etaTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  etaSub: { marginTop: 2, fontSize: 13, color: '#444' },
  bottomActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    marginLeft: 8, backgroundColor: '#f4f4f4', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
  },
  actionIcon: { fontSize: 16 },
  exitBtn: { backgroundColor: '#ffe9e9' },
  exitIcon: { fontSize: 18, color: '#c33', fontWeight: '700' },

  // “Hizala” (opsiyonel)
  alignButton: {
    position: 'absolute',
    bottom: 110,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 4,
  },
  alignText: { fontWeight: '600', color: '#111' },

  // Reroute etiketi
  rerouteBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 90 : 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rerouteText: { color: '#fff', fontWeight: '600' },
});
