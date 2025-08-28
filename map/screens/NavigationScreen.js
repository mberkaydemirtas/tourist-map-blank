// src/screens/NavigationScreen.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, PermissionsAndroid, Platform, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

import {
  decodePolyline,
  getTurnByTurnSteps,
  getRoute,
  getNearbyPlaces,
  getPlaceDetails,
} from '../maps';

import StepInstructionsModal from '../navigation/components/StepInstructionsModal';
import LaneGuidanceBar from '../navigation/components/LaneGuidanceBar';
import NextManeuverChip from '../navigation/components/NextManeuverChip';
import AddStopButton from '../components/AddStopButton';
import AddStopOverlay from '../components/AddStopOverlay';
import EditStopsOverlay from '../components/EditStopsOverlay2';

import { useNavigationLogic } from '../navigation/useNavigationLogic';
import useNavSim from '../navigation/useNavSim';
import useAltRoutes from '../navigation/useAltRoutes';
import useNavPOI from '../navigation/useNavPOI';

import { distanceToPolylineMeters } from '../navigation/navMath';
import { focusOn } from '../navigation/cameraUtils';
import { metersBetween as getDistanceMeters } from '../navigation/navMath';

import useSafePolyline from '../navigation/useSafePolyline';
import useTurnByTurn from '../navigation/useTurnByTurn';
import { metersFmt, formatDurationShort, formatETA } from '../navigation/navFormatters';

// helpers
import {
  getManeuverTarget,
  getStepDistanceValue,
  getStepDurationValue,
  formatInstructionTR,
  formatInstructionRelativeTR,
  shortDirectiveTR,
  getTwoStageThresholds,
  calcRemaining,
} from '../navigation/instructions';

// hooks
import useRouteRecalc from '../navigation/hooks/useRouteRecalc';
import useWaypointsManager from '../navigation/hooks/useWaypointsManager';
import useNavCamera from '../navigation/hooks/useNavCamera';
import useSnapToRoute from '../navigation/hooks/useSnapToRoute';

// components
import PoiMarkers from '../navigation/components/PoiMarkers';
import WaypointMarkers from '../navigation/components/WaypointMarkers';
import AltRoutesLayer from '../navigation/components/AltRoutesLayer';

/* -------------------------- Basit yardımcılar -------------------------- */
const toLL = (p) => {
  if (!p) return null;
  const lat = p.lat ?? p.latitude;
  const lng = p.lng ?? p.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const baseSpeak = async (text) => {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'tr-TR', pitch: 1.0, rate: 1.0 });
  } catch {}
};

const buzz = async () => {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
};

/* --------------------------------- Ekran --------------------------------- */
export default function NavigationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const [mapReady, setMapReady] = useState(false);

  // ---- Parametreler ----
  const {
    from: initialFrom,
    to: initialTo,
    polyline,
    steps: initialSteps = [],
    mode: initialMode = 'driving',
    waypoints: initialWaypoints = [],
  } = route.params ?? {};

  // ---- Refs / Flags ----
  const followBackSuppressedRef = useRef(false);
  const pendingOpRef = useRef(null);
  const replaceModeRef = useRef(false);
  const poiActiveRef = useRef({ type: null, query: null });
  const addStopOpenRef = useRef(false);
  const [addStopOpen, setAddStopOpen] = useState(false);

  // ---- State ----
  const [locationPermission, setLocationPermission] = useState(false);

  const markerRefs = useRef(new Map());
  const setMarkerRef = useCallback((id, ref) => {
    if (!id) return;
    if (ref) markerRefs.current.set(id, ref);
    else markerRefs.current.delete(id);
  }, []);

  const [showSteps, setShowSteps] = useState(false);

  const [heading, setHeading] = useState(null);

  const [steps, setSteps] = useState(Array.isArray(initialSteps) ? initialSteps : []);
  const norm = (p) =>
    p
      ? {
          latitude: p?.coords?.latitude ?? p.latitude ?? p.lat,
          longitude: p?.coords?.longitude ?? p.longitude ?? p.lng,
        }
      : null;
  const [from, setFrom] = useState(norm(initialFrom));
  const [to, setTo] = useState(norm(initialTo));
  const [mode, setMode] = useState(initialMode);

  const [navStarted, setNavStarted] = useState(false);

  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const speak = useCallback((text) => { if (!mutedRef.current) baseSpeak(text); }, []);

  // konuşma throttling
  const lastSpeechAtRef = useRef(0);
  const speechHoldUntilRef = useRef(0);
  const safeSpeak = useCallback((text, cooldownMs = 1500) => {
    const now = Date.now();
    if (now - lastSpeechAtRef.current < cooldownMs) return;
    lastSpeechAtRef.current = now;
    speak(text);
  }, [speak]);

  // konuşma flag’leri
  const [spokenFlags, setSpokenFlags] = useState({});
  const spokenRef = useRef({});
  useEffect(() => { spokenRef.current = spokenFlags; }, [spokenFlags]);

  // Waypoints yönetimi
  const {
    waypoints,
    setWaypoints,
    waypointsRef,
    resolvePlace,
  } = useWaypointsManager({ initialWaypoints, getPlaceDetails });

  useEffect(() => { addStopOpenRef.current = addStopOpen; }, [addStopOpen]);

  const stepIndexRef = useRef(0);

  // Kamera adapter
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  useEffect(() => {
    const regionFromBounds = (ne, sw) => {
      const latDelta = Math.max(0.005, Math.abs(ne.lat - sw.lat) * 1.2);
      const lngDelta = Math.max(0.005, Math.abs(ne.lng - sw.lng) * 1.2);
      return {
        latitude: (ne.lat + sw.lat) / 2,
        longitude: (ne.lng + sw.lng) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      };
    };
    cameraRef.current = {
      fitBounds: ([neLng, neLat], [swLng, swLat], _pad = 50, duration = 500) => {
        const ne = { lat: neLat, lng: neLng };
        const sw = { lat: swLat, lng: swLng };
        const region = regionFromBounds(ne, sw);
        mapRef.current?.animateToRegion(region, duration);
      },
      setCamera: ({ centerCoordinate, heading, pitch, zoom, animationDuration = 300 }) => {
        if (!centerCoordinate) return;
        const [lng, lat] = centerCoordinate;
        mapRef.current?.animateCamera(
          { center: { latitude: lat, longitude: lng }, heading, pitch, zoom },
          { duration: animationDuration }
        );
      },
    };
  }, []);

  // Base polyline (ilk render)
  const baseRouteCoordinates = useMemo(() => {
    if (polyline) {
      return decodePolyline(polyline).map((c) => [c.longitude, c.latitude]); // [lng,lat]
    }
    const toLngLat = (p) => (p ? [p.longitude ?? p.lng, p.latitude ?? p.lat] : null);
    const a = toLngLat(from);
    const b = toLngLat(to);
    return a && b ? [a, b] : [];
  }, [polyline, from, to]);

  // pauseFollowing proxy (TDZ kırmak için)
  const pauseFollowingRef = useRef((/* ms */) => {});
  const pauseFollowingStable = useCallback((ms = 2500) => {
    return pauseFollowingRef.current?.(ms);
  }, []);
  const forceFollowRef = useRef(false);

  // Route reset
  const onRouteReset = useCallback(() => {
    lastSpeechAtRef.current = 0;
    speechHoldUntilRef.current = 0;
    stepIndexRef.current = 0;
    forceFollowRef.current = true;
    setSpokenFlags({});
    spokenRef.current = {};
  }, []);

  // Route hesap/yeniden-hesap
  const {
    primaryRoute,
    isRerouting,
    pendingRouteMeta: pendingMetaFromHook,
    routeCoordinates,
    fetchRoute,
    recalcRoute,
    beginRouteUpdate,
    finalizeRouteSteps,
  } = useRouteRecalc({
    from, to, mode,
    baseRouteCoordinates,
    waypointsRef,
    cameraRef,
    poiActiveRef,
    addStopOpenRef,
    pauseFollowing: pauseFollowingStable,
    speak,
    getRoute,
    decodePolyline,
    getTurnByTurnSteps,
    setSteps,
    onRouteReset,
  });

  // begin/finalize kimliklerini sabitle
  const beginRouteUpdateRef = useRef(beginRouteUpdate);
  useEffect(() => { beginRouteUpdateRef.current = beginRouteUpdate; }, [beginRouteUpdate]);
  const finalizeRouteStepsRef = useRef(finalizeRouteSteps);
  useEffect(() => { finalizeRouteStepsRef.current = finalizeRouteSteps; }, [finalizeRouteSteps]);
  const beginRouteUpdateStable = useCallback((...a) => beginRouteUpdateRef.current?.(...a), []);
  const finalizeRouteStepsStable = useCallback((...a) => finalizeRouteStepsRef.current?.(...a), []);

  const rnPolyline = useMemo(
    () => (Array.isArray(routeCoordinates) ? routeCoordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) : []),
    [routeCoordinates]
  );
  const safePolylineCoords = useSafePolyline(routeCoordinates);

  // 🔧 TEK ve STABİL routeCoordsRef
  const routeCoordsRef = useRef(routeCoordinates);
  useEffect(() => { routeCoordsRef.current = routeCoordinates; }, [routeCoordinates]);

  // İzin
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

  // Navigation core — routeInfo’yu memo’la
  const routeInfo = useMemo(() => {
    if (!primaryRoute) return null;
    const d = primaryRoute.distance;
    const t = primaryRoute.duration;
    return { distance: d, duration: t };
  }, [primaryRoute?.distance, primaryRoute?.duration]);

  // --- FIX: recalcRoute değişimini ref’e aynala ve onOffRoute’u STABİL yap ---
  const recalcRouteRef = useRef(recalcRoute);
  useEffect(() => { recalcRouteRef.current = recalcRoute; }, [recalcRoute]);

  const onOffRouteCb = useCallback(async (user) => {
    // Her zaman aynı kimlikte kalsın; içerde güncel fonksiyona ref’ten eriş.
    await recalcRouteRef.current?.({
      originLat: user.latitude,
      originLng: user.longitude,
      keepSpeak: true,
    });
  }, []); // ❗ bağımlılık yok → kimlik sabit

  const nav = useNavigationLogic({
    mapRef,
    routeCoords: rnPolyline,
    routeInfo,                 // sabit obje
    selectedMode: mode,
    offRouteThresholdM: 50,
    onOffRoute: onOffRouteCb,  // sabit callback (FIX)
    voice: !muted,
    externalFeed: true,
  });

  const lastLocRef = useRef(null);
  useEffect(() => { if (nav?.location) lastLocRef.current = nav.location; }, [nav?.location]);

  // Turn-by-turn
  const {
    currentStepIndex,
    distanceToManeuver,
    liveRemain,
    speakBanner,
  } = useTurnByTurn({
    steps,
    heading,
    location: nav?.location ?? null,
    routeCoordsRef,
    speak,
    buzz,
    helpers: useMemo(() => ({
      getDistanceMeters,
      getManeuverTarget,
      getStepDistanceValue,
      getStepDurationValue,
      formatInstructionTR,
      formatInstructionRelativeTR,
      shortDirectiveTR,
      getTwoStageThresholds,
      calcRemaining,
    }), []),
    // FIX: onArrive kimliğini sabitle
    onArrive: useCallback(() => {
      speak('Varış noktasına ulaştınız.');
    }, [speak]),
  });

  // Kamera + follow
  const {
    camZoom, camPitch,
    isFollowing, setIsFollowing,
    isMapTouched, setIsMapTouched,
    onMapPress, onPanDrag, scheduleFollowBack, goFollowNow,
    pauseFollowing, followHoldUntilRef,
  } = useNavCamera({
    nav,
    distanceToManeuver,
    followBackSuppressedRef,
  });

  // proxy'yi gerçek fonksiyonla bağla + reset sonrası follow aç
  useEffect(() => { pauseFollowingRef.current = pauseFollowing; }, [pauseFollowing]);
  useEffect(() => {
    if (forceFollowRef.current) {
      setIsFollowing(true);
      forceFollowRef.current = false;
    }
  }, [setIsFollowing]);

  // Snap-to-route (ghost)
  const { snapCoord } = useSnapToRoute({
    routeCoordinates,
    location: nav?.location ? { latitude: nav.location.latitude, longitude: nav.location.longitude } : null,
    isFollowing,
    maxSnapM: 20,
  });

  // Simülasyon
  const {
    simActive, setSimActive,
    simSpeedKmh, setSimSpeedKmh,
    simCoord
  } = useNavSim({
    routeCoordinates,
    metersBetween: getDistanceMeters,
    onTick: ({ lat, lng, heading, speed }) => {
      nav.ingestExternalLocation?.({ latitude: lat, longitude: lng, heading, speed });
    },
  });

  // İlk route fetch (kimlik sabit; sadece mapReady olduğunda 1 kez)
  const fetchRouteRef = useRef(fetchRoute);
  useEffect(() => { fetchRouteRef.current = fetchRoute; }, [fetchRoute]);
  const didFetchInitialRef = useRef(false);
  useEffect(() => {
    if (!mapReady || didFetchInitialRef.current) return;
    didFetchInitialRef.current = true;
    fetchRouteRef.current?.();
  }, [mapReady]);

  // Steps ilk çekim guard
  const triedStepsFetchRef = useRef(false);
  useEffect(() => {
    const hasAnyGeometry =
      Array.isArray(steps) &&
      steps.some(
        (s) =>
          (s?.geometry?.type === 'LineString' &&
            Array.isArray(s.geometry.coordinates) &&
            s.geometry.coordinates.length > 1) ||
          !!s?.polyline
      );
    const valid =
      from?.latitude != null && from?.longitude != null &&
      to?.latitude != null && to?.longitude != null;

    if (!hasAnyGeometry && valid && !triedStepsFetchRef.current) {
      triedStepsFetchRef.current = true;
      (async () => {
        try {
          const mSteps = await getTurnByTurnSteps(toLL(from), toLL(to));
          if (Array.isArray(mSteps) && mSteps.length > 0) setSteps(mSteps);
        } catch {}
      })();
    }
  }, [steps, from, to, getTurnByTurnSteps]);

  /* ------------ onInsertStop: stabil wrapper + iç mantık (ref) ------------ */
  const insertOrAppendStopRef = useRef(null);
  const onInsertStop = useCallback((payload) => {
    return insertOrAppendStopRef.current?.(payload);
  }, []);

  // POI arama/ekleme (hook)
  const {
    poiActive,
    stablePoiList,
    selectedId, setSelectedId,
    candidateStop, setCandidateStop,
    isAddingStop,
    clearPoi,
    handleNavCategorySelect,
    handleQuerySubmit,
    handleAddStopFromPOI,
    onPoiPress,
    getRouteBounds,
  } = useNavPOI({
    routeCoordsRef,
    cameraRef,
    pauseFollowing: pauseFollowingStable,
    getNearbyPlaces,
    getPlaceDetails,
    onInsertStop, // sabit
    metersBetween: getDistanceMeters,
    distanceToPolylineMeters,
    addStopOpen,
  });

  // Follow suppression (POI/overlay açıkken)
  useEffect(() => { poiActiveRef.current = poiActive; }, [poiActive]);
  useEffect(() => {
    followBackSuppressedRef.current =
      addStopOpen || !!selectedId || !!candidateStop ||
      !!poiActive.type || !!poiActive.query;
  }, [addStopOpen, selectedId, candidateStop, poiActive]);

  // UI helpers
  useEffect(() => {
    if (!navStarted && steps && steps.length > 0) {
      setNavStarted(true);
      speak('Navigasyon başlatıldı.');
    }
  }, [steps, navStarted, speak]);

  // Durak Ekle / Düzenle
  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]);
  const [insertIndex, setInsertIndex] = useState(null);
  const insertIndexRef = useRef(null);
  useEffect(() => { insertIndexRef.current = insertIndex; }, [insertIndex]);
  const pendingInsertRef = useRef(null);

  // Gerçek iş mantığı — ref’e yazılacak
  const insertOrAppendStopInner = useCallback(({ lat, lng, name, place_id, address }) => {
    const payload = { lat, lng, place_id, name, address };
    focusOn(cameraRef, (ms) => pauseFollowingRef.current?.(ms), lng, lat, 18);

    const op = pendingOpRef.current;
    const hasOp = op && Number.isFinite(op.index);
    const idx = hasOp ? op.index
      : Number.isFinite(insertIndexRef.current) ? insertIndexRef.current
      : Number.isFinite(insertIndex) ? insertIndex
      : null;
    const opType = hasOp ? op.type : (replaceModeRef.current ? 'replace' : 'insert');

    if (idx != null) {
      setDraftStops(prev => {
        const next = [...prev];
        if (opType === 'replace') next.splice(idx, 1, payload);
        else next.splice(idx, 0, payload);

        const newWps = next.slice(1, -1);
        setWaypoints(newWps);
        recalcRoute({ keepSpeak: false, waypointsOverride: newWps });
        return next;
      });

      // cleanup
      pendingOpRef.current = null;
      replaceModeRef.current = false;
      pendingInsertRef.current = null;
      insertIndexRef.current = null;
      setInsertIndex(null);
      setAddStopOpen(false);
      setEditStopsOpen(false);
      setSelectedId(null);
      setCandidateStop(null);
      clearPoi();
      return;
    }

    // sona ekle
    setWaypoints(prev => {
      const next = [...prev, payload];
      recalcRoute({ keepSpeak: false, waypointsOverride: next });
      return next;
    });

    setSelectedId(null);
    setCandidateStop(null);
    clearPoi();
  }, [insertIndex, recalcRoute, setWaypoints, clearPoi, setEditStopsOpen, setAddStopOpen, setInsertIndex, setSelectedId, setCandidateStop]);

  useEffect(() => { insertOrAppendStopRef.current = insertOrAppendStopInner; }, [insertOrAppendStopInner]);

  const handlePickStop = useCallback(async (place) => {
    const payload = await resolvePlace(place);
    if (!payload) return;
    onInsertStop(payload);
    setAddStopOpen(false);
  }, [resolvePlace, onInsertStop]);

  // kalan mesafe/süre
  const effSec = liveRemain?.sec ?? pendingMetaFromHook?.sec ?? null;
  const effDist = liveRemain?.dist ?? pendingMetaFromHook?.dist ?? null;

  // Alternatif rotalar
  const {
    altMode,
    altFetching,
    altRoutes,
    toggleAlternatives,
    applyAlternative,
  } = useAltRoutes({
    from,
    to,
    waypointsRef,
    routeCoordsRef,
    lastLocRef,
    getRoute,
    decodePolyline,
    getTurnByTurnSteps,
    effSec,
    isAddingStop,
    beginRouteUpdate: beginRouteUpdateStable,
    finalizeRouteSteps: finalizeRouteStepsStable,
    safeSpeak,
  });

  const etaStr = nav?.eta
    ? nav.eta.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : formatETA(effSec);

  const remainDistStr = (nav?.remainingM ?? effDist) != null
    ? metersFmt(nav?.remainingM ?? effDist)
    : '—';

  const remainDurStr = formatDurationShort(nav?.remainingS ?? effSec);

  const progressPct = useMemo(() => {
    const total = nav?.totalM ?? (primaryRoute?.distance ?? 0);
    const remain = nav?.remainingM ?? (effDist ?? 0);
    if (!total || !Number.isFinite(total)) return 0;
    const pct = ((total - remain) / total) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }, [nav?.totalM, nav?.remainingM, effDist, primaryRoute?.distance]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        renderToHardwareTextureAndroid
        androidHardwareAccelerationDisabled={false}
        onMapReady={() => setMapReady(true)}
        initialRegion={{
          latitude: from?.latitude ?? 39.92,
          longitude: from?.longitude ?? 32.85,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={!!locationPermission}
        onUserLocationChange={(e) => {
          if (simActive) return;
          const c = e?.nativeEvent?.coordinate;
          if (c) nav.ingestExternalLocation?.({
            latitude: c.latitude,
            longitude: c.longitude,
            heading: c.heading,
            speed: c.speed,
          });
        }}
        onPress={onMapPress}
        onPanDrag={onPanDrag}
      >
        {/* Başlangıç / Varış */}
        {from && <Marker coordinate={{ latitude: from.latitude, longitude: from.longitude }} />}
        {to && <Marker coordinate={{ latitude: to.latitude, longitude: to.longitude }} />}

        {/* Aday durak */}
        {candidateStop && Number.isFinite(candidateStop.lat) && Number.isFinite(candidateStop.lng) && (
          <Marker coordinate={{ latitude: candidateStop.lat, longitude: candidateStop.lng }}>
            <View style={styles.candidateDotOuter}><View style={styles.candidateDotInner} /></View>
          </Marker>
        )}

        {/* Waypoints */}
        <WaypointMarkers waypoints={waypoints} />

        {/* POI’ler */}
        <PoiMarkers
          stablePoiList={stablePoiList}
          setMarkerRef={setMarkerRef}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onPoiPress={onPoiPress}
          handleAddStopFromPOI={handleAddStopFromPOI}
        />

        {/* Mavi aktif rota */}
        {safePolylineCoords.length > 1 && (
          <Polyline coordinates={safePolylineCoords} strokeWidth={6} strokeColor="#1E88E5" />
        )}

        {/* Gri alternatif rotalar + etiketler */}
        <AltRoutesLayer
          altMode={altMode}
          altFetching={altFetching}
          isAddingStop={isAddingStop}
          altRoutes={altRoutes}
          baselineSec={effSec}
          applyAlternative={applyAlternative}
        />

        {/* Simülasyon kullanıcı noktası */}
        {simActive && simCoord && (
          <Marker coordinate={{ latitude: simCoord.lat, longitude: simCoord.lng }}>
            <View style={styles.simUserDotOuter}><View style={styles.simUserDotInner} /></View>
          </Marker>
        )}

        {/* Snap-to-route hayalet */}
        {snapCoord && isFollowing && (
          <Marker coordinate={{ latitude: snapCoord.lat, longitude: snapCoord.lng }}>
            <View style={styles.snapDot} />
          </Marker>
        )}
      </MapView>

      {isRerouting && (
        <View style={styles.rerouteBadge}><Text style={styles.rerouteText}>Rota güncelleniyor…</Text></View>
      )}

      {/* Harita üstü kontroller */}
      <View style={styles.topControls} pointerEvents="box-none">
        <TouchableOpacity
          style={[
            styles.topBtn,
            altMode && !isAddingStop && styles.topBtnActive,
            isAddingStop && styles.topBtnDisabled,
          ]}
          onPress={toggleAlternatives}
          disabled={isAddingStop}
        >
          <Text style={styles.topBtnIcon}>
            {waypoints.length > 0 ? '⛔' : altMode ? (altFetching ? '⏳' : '✖️') : '🛣️'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => { Speech.stop(); setMuted((m) => !m); }}>
          <Text style={styles.actionIcon}>{muted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
      </View>

      {/* Üst banner */}
      <TouchableOpacity activeOpacity={0.8} style={styles.banner} onPress={speakBanner}>
        <View style={styles.bannerStack}>
          <LaneGuidanceBar step={steps?.[currentStepIndex]} iconsOnly style={{ marginBottom: 6 }} />
          <Text style={styles.bannerTitle}>
            {formatInstructionRelativeTR(heading, steps?.[currentStepIndex])}
            {Number.isFinite(distanceToManeuver) ? ` • ${metersFmt(distanceToManeuver)}` : ''}
          </Text>
        </View>
        {!!steps?.[currentStepIndex + 1] && (
          <NextManeuverChip
            step={steps[currentStepIndex + 1]}
            distance={getStepDistanceValue(steps[currentStepIndex + 1])}
          />
        )}
      </TouchableOpacity>

      {primaryRoute?.distance && primaryRoute?.duration && (
        <View style={styles.infoBar}>
          <Text style={styles.infoText}>
            {Math.round(primaryRoute.duration/60)} dk • {(primaryRoute.distance/1000).toFixed(1)} km
          </Text>
        </View>
      )}

      {/* Tek buton: Durak ekle */}
      <AddStopButton onPress={() => setAddStopOpen(true)} />

      {/* Alt çubuk */}
      <View style={styles.bottomBar} pointerEvents="box-none">
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.bottomInfo}>
            <Text style={styles.etaTitle}>Varış: {etaStr}</Text>
            <Text style={styles.etaSub}>
              {remainDistStr} • {remainDurStr}{waypoints.length ? ` • ${waypoints.length} durak` : ''}
            </Text>
          </View>

          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => setSimActive((v) => !v)}>
              <Text style={styles.actionIcon}>{simActive ? '⏸️' : '▶️'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setSimSpeedKmh((s) => (s <= 10 ? 30 : s <= 30 ? 60 : 10))}
            >
              <Text style={styles.actionIcon}>
                {simActive ? (simSpeedKmh <= 10 ? '🐢' : simSpeedKmh <= 30 ? '🚗' : '🏎️') : '🏁'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.exitBtn]}
              onPress={() => { Speech.stop(); setSimActive(false); navigation.goBack(); }}
            >
              <Text style={styles.exitIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Haritayı hizala butonu */}
      {isMapTouched && (
        <TouchableOpacity style={styles.alignButton} onPress={goFollowNow}>
          <Text style={styles.alignText}>📍 Hizala</Text>
        </TouchableOpacity>
      )}

      {/* “Durakları düzenle” kısayolu */}
      {waypoints.length > 0 && !addStopOpen && !poiActive.type && !poiActive.query && (
        <TouchableOpacity
          style={[styles.actionBtn, { position: 'absolute', right: 16, bottom: 200 }]}
          onPress={() => {
            const fromStop = { lat: from.latitude, lng: from.longitude, name: 'Başlangıç' };
            const toStop = { lat: to.latitude, lng: to.longitude, name: 'Bitiş' };
            setDraftStops([fromStop, ...waypoints, toStop]);
            setEditStopsOpen(true);
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.actionIcon}> Durakları düzenle</Text>
        </TouchableOpacity>
      )}

      {/* “Ekleme” modu iptal */}
      {isAddingStop && (
        <TouchableOpacity
          style={styles.cancelAddBtn}
          onPress={() => {
            setAddStopOpen(false);
            setSelectedId(null);
            setCandidateStop(null);
            clearPoi();
            setInsertIndex(null);
            insertIndexRef.current = null;
            pendingInsertRef.current = null;
            replaceModeRef.current = false;
            if (Platform.OS === 'ios') {
              markerRefs.current.forEach((ref) => ref?.hideCallout?.());
            }
          }}
          activeOpacity={0.9}
        >
          <Text style={styles.cancelAddText}>Durak İptali</Text>
        </TouchableOpacity>
      )}

      {/* Durak Ekle Overlay */}
      <AddStopOverlay
        visible={addStopOpen}
        onClose={() => { setAddStopOpen(false); clearPoi(); setCandidateStop(null); }}
        onCategorySelect={(type) => { if (!type) return clearPoi(); handleNavCategorySelect(type); }}
        onQuerySubmit={handleQuerySubmit}
        onPickStop={handlePickStop}
        onAddStop={(p) => { handleAddStopFromPOI(p); setAddStopOpen(false); }}
        routeBounds={poiActive?.type ? getRouteBounds() : null}
      />

      {/* Durakları düzenle */}
      <EditStopsOverlay
        visible={editStopsOpen}
        stops={draftStops}
        onClose={() => { setEditStopsOpen(false); setDraftStops([]); setInsertIndex(null); }}
        onConfirm={() => {
          if (!draftStops || draftStops.length < 2) return;
          const newFrom = draftStops[0];
          const newTo = draftStops[draftStops.length - 1];
          const newWps = draftStops.slice(1, -1);

          setFrom({ latitude: newFrom.lat, longitude: newFrom.lng });
          setTo({ latitude: newTo.lat, longitude: newTo.lng });
          setWaypoints(newWps);

          setEditStopsOpen(false);
          setInsertIndex(null);

          recalcRoute({
            keepSpeak: false,
            waypointsOverride: newWps,
            originLat: newFrom.lat,
            originLng: newFrom.lng,
          });
        }}
        onDragEnd={(fromIdx, toIdx) => setDraftStops((prev) => {
          if (fromIdx === toIdx) return prev;
          const next = [...prev];
          const [it] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, it);
          return next;
        })}
        onDelete={(i) => setDraftStops((prev) => prev.filter((_, idx) => idx !== i))}
        onInsertAt={(i) => {
          if (!Number.isFinite(i)) return;
          insertIndexRef.current = i;
          pendingInsertRef.current = i;
          pendingOpRef.current = { type: 'insert', index: i };
          replaceModeRef.current = false;

          setInsertIndex(i);
          setAddStopOpen(true);
          setEditStopsOpen(false);
        }}
        onReplaceAt={(i) => {
          if (!Number.isFinite(i)) return;
          insertIndexRef.current = i;
          pendingInsertRef.current = i;
          pendingOpRef.current = { type: 'replace', index: i };
          replaceModeRef.current = true;

          setInsertIndex(i);
          setAddStopOpen(true);
          setEditStopsOpen(false);
        }}
      />

      <StepInstructionsModal visible={showSteps} steps={steps} onClose={() => setShowSteps(false)} />
    </View>
  );
}

/* --------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { ...StyleSheet.absoluteFillObject },

  infoBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 90 : 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  infoText: { color: '#fff', fontWeight: '700' },

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
  bannerStack: {},
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#111', flexShrink: 1 },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
    paddingHorizontal: 12,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    elevation: 12,
  },
  progressTrack: { height: 3, backgroundColor: '#e8e8e8', borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: 3, backgroundColor: '#1E88E5' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bottomInfo: { flexShrink: 1 },
  etaTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  etaSub: { marginTop: 2, fontSize: 13, color: '#444' },
  bottomActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { marginLeft: 8, backgroundColor: '#f4f4f4', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  actionIcon: { fontSize: 16 },
  exitBtn: { backgroundColor: '#ffe9e9' },
  exitIcon: { fontSize: 18, color: '#c33', fontWeight: '700' },

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

  simUserDotOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(30,136,229,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(30,136,229,0.35)',
  },
  simUserDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1E88E5' },

  snapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E88E5',
    borderWidth: 2,
    borderColor: 'white',
  },

  topControls: { position: 'absolute', top: Platform.OS === 'ios' ? 110 : 80, right: 12, flexDirection: 'row', zIndex: 50 },
  topBtn: { marginLeft: 8, backgroundColor: 'white', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, elevation: 6 },
  topBtnActive: { backgroundColor: '#E8F1FF' },
  topBtnDisabled: { opacity: 0.4 },
  topBtnIcon: { fontSize: 18 },

  // Aday durak
  candidateDotOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(220,53,69,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(220,53,69,0.5)',
  },
  candidateDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC3545' },

  cancelAddBtn: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  cancelAddText: { fontWeight: '700', color: '#B42318' },
});
