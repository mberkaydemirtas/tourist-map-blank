// src/screens/NavigationScreen.js
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  View,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import MapLayer from './Navigation/map/MapLayer';

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

import useRouteRecalc from '../navigation/hooks/useRouteRecalc';
import useWaypointsManager from '../navigation/hooks/useWaypointsManager';
import useNavCamera from '../navigation/hooks/useNavCamera';
import useSnapToRoute from '../navigation/hooks/useSnapToRoute';

import PoiMarkers from '../navigation/components/PoiMarkers';
import WaypointMarkers from '../navigation/components/WaypointMarkers';
import AltRoutesLayer from '../navigation/components/AltRoutesLayer';

const toLL = (p) => {
  if (!p) return null;
  const lat = p.lat ?? p.latitude ?? p?.coords?.latitude;
  const lng = p.lng ?? p.lon ?? p.longitude ?? p?.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const firstNum = (...vals) => {
  for (const v of vals) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
};
const norm = (p) => {
  if (!p) return null;
  const lat =
    num(p?.coords?.latitude) ?? num(p?.latitude) ?? num(p?.lat);
  const lng =
    num(p?.coords?.longitude) ??
    num(p?.longitude) ??
    num(p?.lng) ??
    num(p?.lon);
  if (lat == null || lng == null) return null;
  return { latitude: lat, longitude: lng };
};
const isCoord = (p) =>
  Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude);

const baseSpeak = async (text) => {
  try {
    Speech.stop();
    Speech.speak(text, {
      language: 'tr-TR',
      pitch: 1.0,
      rate: 1.0,
    });
  } catch {}
};
const buzz = async () => {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
};
const EDGE = 60;

export default function NavigationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);

  // ---- Params ----
  const {
    from: initialFrom,
    initialFrom: fallbackFrom,
    to: initialTo,
    polyline,
    polylineEncoded,
    polylineCoords,
    steps: initialSteps = [],
    mode: initialMode = 'driving',
    waypoints: initialWaypoints = [],
    prevStop,
    nextStop,
    destOrder,
    toOrder,
  } = route.params ?? {};

  const loggedRef = useRef(false);
  useEffect(() => {
    if (__DEV__ && !loggedRef.current) {
      console.log('[Nav] initialWaypoints', initialWaypoints);
      console.log('[Nav] initialFrom:', initialFrom);
      console.log('[Nav] fallbackFrom:', fallbackFrom);
      loggedRef.current = true;
    }
  }, [initialWaypoints, initialFrom, fallbackFrom]);

  // ---- Refs / flags ----
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
  const [steps, setSteps] = useState(
    Array.isArray(initialSteps) ? initialSteps : []
  );

  const [from, setFrom] = useState(norm(initialFrom));
  const [to, setTo] = useState(norm(initialTo));
  const [mode, setMode] = useState(initialMode);

  const [navStarted, setNavStarted] = useState(false);

  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  const speak = useCallback((text) => {
    if (!mutedRef.current) baseSpeak(text);
  }, []);
  const lastSpeechAtRef = useRef(0);
  const speechHoldUntilRef = useRef(0);
  const safeSpeak = useCallback(
    (text, cooldownMs = 1500) => {
      const now = Date.now();
      if (now - lastSpeechAtRef.current < cooldownMs) return;
      lastSpeechAtRef.current = now;
      speak(text);
    },
    [speak]
  );

  const [spokenFlags, setSpokenFlags] = useState({});
  const spokenRef = useRef({});
  useEffect(() => {
    spokenRef.current = spokenFlags;
  }, [spokenFlags]);

  const {
    waypoints,
    setWaypoints,
    waypointsRef,
    resolvePlace,
  } = useWaypointsManager({
    initialWaypoints,
    getPlaceDetails,
  });

  useEffect(() => {
    addStopOpenRef.current = addStopOpen;
  }, [addStopOpen]);

  const stepIndexRef = useRef(0);

  // Camera adapter
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
      setCamera: ({
        centerCoordinate,
        heading,
        pitch,
        zoom,
        animationDuration = 300,
      }) => {
        if (!centerCoordinate) return;
        const [lng, lat] = centerCoordinate;
        mapRef.current?.animateCamera(
          {
            center: { latitude: lat, longitude: lng },
            heading,
            pitch,
            zoom,
          },
          { duration: animationDuration }
        );
      },
    };
  }, []);

  // base polyline
  const baseRouteCoordinates = useMemo(() => {
    if (Array.isArray(polylineCoords) && polylineCoords.length > 1) {
      const normed = polylineCoords
        .map((p) => {
          const lat = p.latitude ?? p.lat;
          const lng = p.longitude ?? p.lng ?? p.lon;
          return [lng, lat];
        })
        .filter(
          ([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng)
        );
      if (normed.length > 1) return normed;
    }
    const enc =
      typeof polylineEncoded === 'string' && polylineEncoded.trim()
        ? polylineEncoded.trim()
        : typeof polyline === 'string' && polyline.trim()
        ? polyline.trim()
        : null;
    if (enc) return decodePolyline(enc).map((c) => [c.longitude, c.latitude]);
    const toLngLat = (p) =>
      p ? [p.longitude ?? p.lng ?? p.lon, p.latitude ?? p.lat] : null;
    const a = toLngLat(from);
    const b = toLngLat(to);
    return a && b ? [a, b] : [];
  }, [polyline, polylineEncoded, polylineCoords, from, to]);

  // pauseFollowing
  const pauseFollowingRef = useRef(() => {});
  const pauseFollowingStable = useCallback(
    (ms = 2500) => pauseFollowingRef.current?.(ms),
    []
  );
  const forceFollowRef = useRef(false);

  // route reset
  const onRouteReset = useCallback(() => {
    lastSpeechAtRef.current = 0;
    speechHoldUntilRef.current = 0;
    stepIndexRef.current = 0;
    forceFollowRef.current = true;
    setSpokenFlags({});
    spokenRef.current = {};
  }, []);

  // route compute
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
    from,
    to,
    mode,
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

  const beginRouteUpdateRef = useRef(beginRouteUpdate);
  useEffect(() => {
    beginRouteUpdateRef.current = beginRouteUpdate;
  }, [beginRouteUpdate]);
  const finalizeRouteStepsRef = useRef(finalizeRouteSteps);
  useEffect(() => {
    finalizeRouteStepsRef.current = finalizeRouteSteps;
  }, [finalizeRouteSteps]);
  const beginRouteUpdateStable = useCallback(
    (...a) => beginRouteUpdateRef.current?.(...a),
    []
  );
  const finalizeRouteStepsStable = useCallback(
    (...a) => finalizeRouteStepsRef.current?.(...a),
    []
  );

  // hedef LL
  const destLL = useMemo(() => {
    const cand =
      to ||
      initialTo ||
      (nextStop && {
        latitude: num(nextStop.latitude) ?? num(nextStop.lat),
        longitude:
          num(nextStop.longitude) ??
          num(nextStop.lng) ??
          num(nextStop.lon),
      });
    if (!cand) return null;
    const lat = num(cand.latitude) ?? num(cand.lat);
    const lng =
      num(cand.longitude) ?? num(cand.lng) ?? num(cand.lon);
    return lat != null && lng != null
      ? { latitude: lat, longitude: lng }
      : null;
  }, [to, initialTo, nextStop]);

  // stop numaraları
  const prevNum = useMemo(
    () =>
      firstNum(
        prevStop?.order,
        prevStop?.idx,
        prevStop?.sequence
      ),
    [prevStop?.order, prevStop?.idx, prevStop?.sequence]
  );
  const destNum = useMemo(
    () =>
      firstNum(
        nextStop?.order,
        destOrder,
        toOrder,
        initialTo?.order
      ),
    [nextStop?.order, destOrder, toOrder, initialTo?.order]
  );

  const rnPolyline = useMemo(
    () =>
      Array.isArray(routeCoordinates)
        ? routeCoordinates.map(([lng, lat]) => ({
            latitude: lat,
            longitude: lng,
          }))
        : [],
    [routeCoordinates]
  );
  const safePolylineCoords = useSafePolyline(routeCoordinates);

  const routeCoordsRef = useRef(routeCoordinates);
  useEffect(() => {
    routeCoordsRef.current = routeCoordinates;
  }, [routeCoordinates]);

  // location permission
  useEffect(() => {
    (async () => {
      try {
        const { status } =
          await Location.requestForegroundPermissionsAsync();
        const ok = status === 'granted';
        setLocationPermission(ok);
        if (!ok && !isCoord(from) && isCoord(fallbackFrom)) {
          console.log('[Nav] İzin reddedildi, from -> fallback');
          setFrom(norm(fallbackFrom));
        }
      } catch {
        if (!isCoord(from) && isCoord(fallbackFrom)) {
          console.log('[Nav] İzin hatası, from -> fallback');
          setFrom(norm(fallbackFrom));
        }
      }
    })();
  }, [fallbackFrom]);

  // permission yoksa prevStop
  useEffect(() => {
    if (!locationPermission && !isCoord(from) && isCoord(prevStop)) {
      setFrom({
        latitude:
          num(prevStop.latitude) ?? prevStop.latitude,
        longitude:
          num(prevStop.longitude) ?? prevStop.longitude,
      });
      console.log('[Nav] from invalid → prevStop (permission yok)');
    }
  }, [locationPermission, from, prevStop]);

  const routeInfo = useMemo(() => {
    if (!primaryRoute) return null;
    return {
      distance: primaryRoute.distance,
      duration: primaryRoute.duration,
    };
  }, [primaryRoute?.distance, primaryRoute?.duration]);

  const recalcRouteRef = useRef(recalcRoute);
  useEffect(() => {
    recalcRouteRef.current = recalcRoute;
  }, [recalcRoute]);
  const onOffRouteCb = useCallback(async (user) => {
    await recalcRouteRef.current?.({
      originLat: user.latitude,
      originLng: user.longitude,
      keepSpeak: true,
    });
  }, []);

  const nav = useNavigationLogic({
    mapRef,
    routeCoords: rnPolyline,
    routeInfo,
    selectedMode: mode,
    offRouteThresholdM: 50,
    onOffRoute: onOffRouteCb,
    voice: false,
    externalFeed: true,
  });

  const lastLocRef = useRef(null);
  useEffect(() => {
    if (nav?.location) lastLocRef.current = nav.location;
  }, [nav?.location]);

  const {
    currentStepIndex,
    distanceToManeuver,
    liveRemain,
  } = useTurnByTurn({
    steps,
    heading,
    location: nav?.location ?? null,
    routeCoordsRef,
    speak,
    buzz,
    helpers: useMemo(
      () => ({
        getDistanceMeters,
        getManeuverTarget,
        getStepDistanceValue,
        getStepDurationValue,
        formatInstructionTR,
        formatInstructionRelativeTR,
        shortDirectiveTR,
        getTwoStageThresholds,
        calcRemaining,
      }),
      []
    ),
    onArrive: useCallback(() => {
      speak('Varış noktasına ulaştınız.');
    }, [speak]),
  });

  const shownStep = steps?.[currentStepIndex];
  const nextStep = steps?.[currentStepIndex + 1] || null;
  const next2Step = steps?.[currentStepIndex + 2] || null;

  const distForBanner = Number.isFinite(distanceToManeuver)
    ? distanceToManeuver
    : null;

  const {
    isFollowing,
    isMapTouched,
    onMapPress,
    onPanDrag,
    goFollowNow,
  } = useNavCamera({
    mapRef,
    location: nav?.location,
    distanceToManeuver,
    followBackSuppressedRef,
    manualReenter: true,
  });

  const { snapCoord } = useSnapToRoute({
    routeCoordinates,
    location: nav?.location
      ? {
          latitude: nav.location.latitude,
          longitude: nav.location.longitude,
        }
      : null,
    isFollowing,
    maxSnapM: 20,
  });

  const {
    simActive,
    setSimActive,
    simSpeedKmh,
    setSimSpeedKmh,
    simCoord,
  } = useNavSim({
    routeCoordinates,
    metersBetween: getDistanceMeters,
    onTick: ({ lat, lng, heading, speed }) => {
      nav.ingestExternalLocation?.({
        latitude: lat,
        longitude: lng,
        heading,
        speed,
      });
    },
  });

  // ilk route fetch
  const fetchRouteRef = useRef(fetchRoute);
  useEffect(() => {
    fetchRouteRef.current = fetchRoute;
  }, [fetchRoute]);
  const didFetchInitialRef = useRef(false);
  useEffect(() => {
    if (!mapReady || didFetchInitialRef.current) return;
    const okFrom = isCoord(from);
    const okTo = isCoord(to) || isCoord(destLL);
    if (okFrom && okTo) {
      console.log('[Nav] mapReady & from,to hazır → rota çek');
      didFetchInitialRef.current = true;
      fetchRouteRef.current?.();
    } else {
      if (!okFrom) console.warn('⚠️ from invalid');
      if (!okTo) console.warn('⚠️ to invalid');
    }
  }, [mapReady, from, to, destLL]);

  // canlı konumdan tek seferlik rota
  const liveRoutedOnceRef = useRef(false);
  useEffect(() => {
    if (!mapReady || liveRoutedOnceRef.current) return;
    if (!isCoord(destLL)) return;
    const c = nav?.location;
    if (isCoord(c)) {
      setFrom({ latitude: c.latitude, longitude: c.longitude });
      if (Array.isArray(rnPolyline) && rnPolyline.length > 1) {
        recalcRouteRef.current?.({
          originLat: c.latitude,
          originLng: c.longitude,
          keepSpeak: false,
        });
      } else {
        fetchRouteRef.current?.();
      }
      liveRoutedOnceRef.current = true;
      try {
        goFollowNow();
      } catch {}
    }
  }, [mapReady, nav?.location, destLL, rnPolyline]);

  // steps guard
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
      isCoord(from) && (isCoord(to) || isCoord(destLL));

    if (!hasAnyGeometry && valid && !triedStepsFetchRef.current) {
      triedStepsFetchRef.current = true;
      (async () => {
        try {
          const src = toLL(from);
          const dst = toLL(isCoord(to) ? to : destLL);
          if (!src || !dst) return;
          const mSteps = await getTurnByTurnSteps(src, dst);
          if (Array.isArray(mSteps) && mSteps.length > 0)
            setSteps(mSteps);
        } catch {}
      })();
    }
  }, [steps, from, to, destLL]);

  // POI / ekleme
  const insertOrAppendStopRef = useRef(null);
  const onInsertStop = useCallback(
    (payload) => insertOrAppendStopRef.current?.(payload),
    []
  );
  const {
    poiActive,
    stablePoiList,
    selectedId,
    setSelectedId,
    candidateStop,
    setCandidateStop,
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
    pauseFollowing: () => {},
    getNearbyPlaces,
    getPlaceDetails,
    onInsertStop,
    metersBetween: getDistanceMeters,
    distanceToPolylineMeters,
    addStopOpen,
  });

  useEffect(() => {
    poiActiveRef.current = poiActive;
  }, [poiActive]);
  useEffect(() => {
    addStopOpenRef.current = addStopOpen;
    followBackSuppressedRef.current =
      addStopOpen ||
      !!selectedId ||
      !!candidateStop ||
      !!poiActive.type ||
      !!poiActive.query;
  }, [addStopOpen, selectedId, candidateStop, poiActive]);

  useEffect(() => {
    if (!navStarted && steps && steps.length > 0) {
      setNavStarted(true);
      speak('Navigasyon başlatıldı.');
    }
  }, [steps, navStarted, speak]);

  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]);
  const [insertIndex, setInsertIndex] = useState(null);
  const insertIndexRef = useRef(null);
  useEffect(() => {
    insertIndexRef.current = insertIndex;
  }, [insertIndex]);
  const pendingInsertRef = useRef(null);

  const insertOrAppendStopInner = useCallback(
    ({ lat, lng, name, place_id, address }) => {
      const payload = { lat, lng, place_id, name, address };
      focusOn(cameraRef, undefined, lng, lat, 18);

      const op = pendingOpRef.current;
      const hasOp = op && Number.isFinite(op.index);
      const idx = hasOp
        ? op.index
        : Number.isFinite(insertIndexRef.current)
        ? insertIndexRef.current
        : Number.isFinite(insertIndex)
        ? insertIndex
        : null;
      const opType = hasOp
        ? op.type
        : replaceModeRef.current
        ? 'replace'
        : 'insert';

      if (idx != null) {
        setDraftStops((prev) => {
          const next = [...prev];
          if (opType === 'replace') next.splice(idx, 1, payload);
          else next.splice(idx, 0, payload);

          const newWps = next.slice(1, -1);
          setWaypoints(newWps);
          recalcRoute({
            keepSpeak: false,
            waypointsOverride: newWps,
          });
          return next;
        });

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

      setWaypoints((prev) => {
        const next = [...prev, payload];
        recalcRoute({ keepSpeak: false, waypointsOverride: next });
        return next;
      });

      setSelectedId(null);
      setCandidateStop(null);
      clearPoi();
    },
    [
      insertIndex,
      recalcRoute,
      setWaypoints,
      clearPoi,
      setEditStopsOpen,
      setAddStopOpen,
      setInsertIndex,
      setSelectedId,
      setCandidateStop,
    ]
  );

  useEffect(() => {
    insertOrAppendStopRef.current = insertOrAppendStopInner;
  }, [insertOrAppendStopInner]);

  const handlePickStop = useCallback(
    async (place) => {
      const payload = await resolvePlace(place);
      if (!payload) return;
      onInsertStop(payload);
      setAddStopOpen(false);
    },
    [resolvePlace, onInsertStop]
  );

  const effSec =
    liveRemain?.sec ?? pendingMetaFromHook?.sec ?? null;
  const effDist =
    liveRemain?.dist ?? pendingMetaFromHook?.dist ?? null;

  const {
    altMode,
    altFetching,
    altRoutes,
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

  const showOSUser = !!locationPermission && !simActive;

  // fallback çizgi
  const currentOrFromOrPrev = useMemo(() => {
    if (isCoord(nav?.location))
      return {
        latitude: nav.location.latitude,
        longitude: nav.location.longitude,
      };
    if (isCoord(from))
      return { latitude: from.latitude, longitude: from.longitude };
    if (!locationPermission && isCoord(prevStop))
      return {
        latitude:
          num(prevStop.latitude) ?? prevStop.latitude,
        longitude:
          num(prevStop.longitude) ?? prevStop.longitude,
      };
    return null;
  }, [nav?.location, from, prevStop, locationPermission]);

  const fallbackLine = useMemo(() => {
    if (currentOrFromOrPrev && isCoord(destLL))
      return [currentOrFromOrPrev, destLL];
    return [];
  }, [currentOrFromOrPrev, destLL]);

  // fit to bounds
  useEffect(() => {
    if (!mapReady) return;
    const pts = [];
    if (currentOrFromOrPrev) pts.push(currentOrFromOrPrev);
    if (destLL) pts.push(destLL);
    if (pts.length >= 2 && mapRef.current?.fitToCoordinates) {
      setTimeout(() => {
        try {
          mapRef.current.fitToCoordinates(pts, {
            edgePadding: {
              top: EDGE,
              bottom: EDGE,
              left: EDGE,
              right: EDGE,
            },
            animated: true,
          });
        } catch {}
      }, 250);
    }
  }, [mapReady, currentOrFromOrPrev, destLL]);

  return (
    <View style={styles.container}>
      {/* Harita layer'ı */}
      <MapLayer
        mapRef={mapRef}
        onMapReady={() => setMapReady(true)}
        initialRegion={{
          latitude: isCoord(from)
            ? from.latitude
            : num(fallbackFrom?.latitude) ??
              num(fallbackFrom?.lat) ??
              39.92,
          longitude: isCoord(from)
            ? from.longitude
            : num(fallbackFrom?.longitude) ??
              num(fallbackFrom?.lng) ??
              num(fallbackFrom?.lon) ??
              32.85,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onUserLocationChange={(e) => {
          if (simActive) return;
          const c = e?.nativeEvent?.coordinate;
          if (!c) return;
          nav.ingestExternalLocation?.({
            latitude: c.latitude,
            longitude: c.longitude,
            heading: c.heading,
            speed: c.speed,
          });
          if (locationPermission && isCoord(destLL)) {
            if (!isCoord(from))
              setFrom({
                latitude: c.latitude,
                longitude: c.longitude,
              });
          }
        }}
        onPress={onMapPress}
        onPanDrag={onPanDrag}
        showUser={showOSUser}
        safePolylineCoords={safePolylineCoords}
        fallbackLine={fallbackLine}
      >
        {/* ----- MARKERLAR ----- */}

        {/* Önceki durak */}
        {isCoord(prevStop) && (
          <Marker
            coordinate={{
              latitude:
                num(prevStop.latitude) ?? prevStop.latitude,
              longitude:
                num(prevStop.longitude) ?? prevStop.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  minWidth: 26,
                  height: 26,
                  borderRadius: 13,
                  paddingHorizontal: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#111827',
                }}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: 13,
                  }}
                >
                  {prevNum ?? ''}
                </Text>
              </View>
              <View
                style={{
                  width: 0,
                  height: 0,
                  borderLeftWidth: 6,
                  borderRightWidth: 6,
                  borderTopWidth: 8,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  marginTop: -1,
                  borderTopColor: '#111827',
                }}
              />
            </View>
          </Marker>
        )}

        {/* Hedef */}
        {isCoord(destLL) && (
          <Marker
            coordinate={destLL}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  minWidth: 26,
                  height: 26,
                  borderRadius: 13,
                  paddingHorizontal: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#DC3545',
                }}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: 13,
                  }}
                >
                  {destNum ?? ''}
                </Text>
              </View>
              <View
                style={{
                  width: 0,
                  height: 0,
                  borderLeftWidth: 6,
                  borderRightWidth: 6,
                  borderTopWidth: 8,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  marginTop: -1,
                  borderTopColor: '#DC3545',
                }}
              />
            </View>
          </Marker>
        )}

        {/* Aday durak */}
        {candidateStop &&
          Number.isFinite(candidateStop.lat) &&
          Number.isFinite(candidateStop.lng) && (
            <Marker
              coordinate={{
                latitude: candidateStop.lat,
                longitude: candidateStop.lng,
              }}
              tracksViewChanges={false}
            >
              <View style={styles.candidateDotOuter}>
                <View style={styles.candidateDotInner} />
              </View>
            </Marker>
          )}

        {/* Waypoints */}
        {(() => {
          const wp = (waypoints || [])
            .map((w) => ({
              latitude: num(w.latitude) ?? w.lat,
              longitude:
                num(w.longitude) ?? w.lng ?? w.lon,
              name: w.name,
              place_id: w.place_id,
            }))
            .filter((p) => {
              const isStart =
                isCoord(from) &&
                Math.abs((from.latitude ?? 0) - p.latitude) <
                  1e-5 &&
                Math.abs((from.longitude ?? 0) - p.longitude) <
                  1e-5;
              const isEnd =
                isCoord(destLL) &&
                Math.abs((destLL.latitude ?? 0) - p.latitude) <
                  1e-5 &&
                Math.abs(
                  (destLL.longitude ?? 0) - p.longitude
                ) < 1e-5;
              return !(isStart || isEnd);
            });
          return wp.length ? (
            <WaypointMarkers waypoints={wp} />
          ) : null;
        })()}

        {/* POI’ler */}
        <PoiMarkers
          stablePoiList={stablePoiList}
          setMarkerRef={setMarkerRef}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onPoiPress={onPoiPress}
          handleAddStopFromPOI={handleAddStopFromPOI}
        />

        {/* Alternatif rotalar */}
        <AltRoutesLayer
          altMode={altMode}
          altFetching={altFetching}
          isAddingStop={isAddingStop}
          altRoutes={altRoutes}
          baselineSec={effSec}
          applyAlternative={applyAlternative}
        />

        {/* Simülasyon noktası */}
        {simActive && simCoord && (
          <Marker
            coordinate={{
              latitude: simCoord.lat,
              longitude: simCoord.lng,
            }}
            tracksViewChanges={false}
          >
            <View style={styles.simUserDotOuter}>
              <View style={styles.simUserDotInner} />
            </View>
          </Marker>
        )}

        {/* Snap-to-route hayalet */}
        {snapCoord && isFollowing && (
          <Marker
            coordinate={{
              latitude: snapCoord.lat,
              longitude: snapCoord.lng,
            }}
            tracksViewChanges={false}
          >
            <View style={styles.snapDot} />
          </Marker>
        )}
      </MapLayer>

      {isRerouting && (
        <View style={styles.rerouteBadge}>
          <Text style={styles.rerouteText}>Rota güncelleniyor…</Text>
        </View>
      )}

      {/* Üst kontroller */}
      <View style={styles.topControls} pointerEvents="box-none">
        <TouchableOpacity style={styles.topBtn} onPress={() => {}}>
          <Text style={styles.topBtnIcon}>🛣️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => {
            Speech.stop();
            setMuted((m) => !m);
          }}
        >
          <Text style={styles.topBtnIcon}>
            {muted ? '🔇' : '🔊'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => setShowSteps(true)}
        >
          <Text style={styles.topBtnIcon}>📜</Text>
        </TouchableOpacity>
      </View>

      {/* Banner */}
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.banner}
        onPress={() => {}}
      >
        <View style={styles.bannerStack}>
          <LaneGuidanceBar
            step={shownStep}
            iconsOnly
            style={{ marginBottom: 6 }}
          />
          <Text style={styles.bannerTitle}>
            {formatInstructionRelativeTR(heading, shownStep)}
            {Number.isFinite(distForBanner)
              ? ` • ${metersFmt(distForBanner)}`
              : ''}
          </Text>
        </View>
        {!!nextStep && (
          <NextManeuverChip
            step={nextStep}
            distance={
              next2Step ? getStepDistanceValue(next2Step) : null
            }
          />
        )}
      </TouchableOpacity>

      {primaryRoute?.distance && primaryRoute?.duration && (
        <View style={styles.infoBar}>
          <Text style={styles.infoText}>
            {Math.round(primaryRoute.duration / 60)} dk •{' '}
            {(primaryRoute.distance / 1000).toFixed(1)} km
          </Text>
        </View>
      )}

      <AddStopButton onPress={() => setAddStopOpen(true)} />

      {/* Alt bar */}
      <View style={styles.bottomBar} pointerEvents="box-none">
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `0%` }]}
          />
        </View>
        <View style={styles.bottomRow}>
          <View style={styles.bottomInfo}>
            <Text style={styles.etaTitle}>
              Varış: {formatETA(effSec)}
            </Text>
            <Text style={styles.etaSub}>
              {(nav?.remainingM ?? effDist) != null
                ? metersFmt(nav?.remainingM ?? effDist)
                : '—'}{' '}
              • {formatDurationShort(nav?.remainingS ?? effSec)}
              {waypoints.length ? ` • ${waypoints.length} durak` : ''}
            </Text>
          </View>
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setSimActive((v) => !v)}
            >
              <Text style={styles.actionIcon}>
                {simActive ? '⏸️' : '▶️'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() =>
                setSimSpeedKmh((s) =>
                  s <= 10 ? 30 : s <= 30 ? 60 : 10
                )
              }
            >
              <Text style={styles.actionIcon}>
                {simActive
                  ? simSpeedKmh <= 10
                    ? '🐢'
                    : simSpeedKmh <= 30
                    ? '🚗'
                    : '🏎️'
                  : '🏁'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.exitBtn]}
              onPress={() => {
                Speech.stop();
                setSimActive(false);

                const coords = routeCoordsRef.current || [];
                let minLat = 90,
                  maxLat = -90,
                  minLng = 180,
                  maxLng = -180;
                for (const [lng, lat] of coords) {
                  if (lat < minLat) minLat = lat;
                  if (lat > maxLat) maxLat = lat;
                  if (lng < minLng) minLng = lng;
                  if (lng > maxLng) maxLng = lng;
                }
                const focusBounds =
                  coords.length >= 2
                    ? {
                        ne: { lat: maxLat, lng: maxLng },
                        sw: { lat: minLat, lng: minLng },
                      }
                    : null;

                const payload = {
                  reopenRouteSheet: true,
                  focusBounds,
                  legLabel: route.params?.legLabel ?? null,
                };

                route.params?.returnOnExit &&
                  route.params.returnOnExit.reopenRouteSheet &&
                  (payload.reopenRouteSheet = true);

                navigation.navigate('TripPlansScreen', payload);
              }}
            >
              <Text style={styles.exitIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {isMapTouched && (
        <TouchableOpacity
          style={styles.alignButton}
          onPress={() => {
            goFollowNow();
            nav.alignNow({
              distToManeuver: distanceToManeuver,
            });
          }}
        >
          <Text style={styles.alignText}>📍 Hizala</Text>
        </TouchableOpacity>
      )}

      {/* Overlays */}
      <AddStopOverlay
        visible={addStopOpen}
        onClose={() => {
          setAddStopOpen(false);
          clearPoi();
          setCandidateStop(null);
        }}
        onCategorySelect={(type) => {
          if (!type) return clearPoi();
          handleNavCategorySelect(type);
        }}
        onQuerySubmit={handleQuerySubmit}
        onPickStop={handlePickStop}
        onAddStop={(p) => {
          handleAddStopFromPOI(p);
          setAddStopOpen(false);
        }}
        routeBounds={poiActive?.type ? getRouteBounds() : null}
      />
      <EditStopsOverlay
        visible={false}
        stops={[]}
        onClose={() => {}}
        onConfirm={() => {}}
        onDragEnd={() => {}}
        onDelete={() => {}}
        onInsertAt={() => {}}
        onReplaceAt={() => {}}
      />

      <StepInstructionsModal
        visible={showSteps}
        onClose={() => setShowSteps(false)}
        steps={steps}
        currentIndex={currentStepIndex}
        onSpeakStep={() => {}}
        onJumpToIndex={() => setShowSteps(false)}
        onSpeakAll={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

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
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    flexShrink: 1,
  },

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
  progressTrack: {
    height: 3,
    backgroundColor: '#e8e8e8',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: 3,
    backgroundColor: '#1E88E5',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomInfo: { flexShrink: 1 },
  etaTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  etaSub: { marginTop: 2, fontSize: 13, color: '#444' },
  bottomActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    marginLeft: 8,
    backgroundColor: '#f4f4f4',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
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
  simUserDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E88E5',
  },

  snapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E88E5',
    borderWidth: 2,
    borderColor: 'white',
  },

  topControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 80,
    right: 12,
    flexDirection: 'row',
    zIndex: 50,
  },
  topBtn: {
    marginLeft: 8,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 6,
  },
  topBtnIcon: { fontSize: 18 },

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
  candidateDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC3545',
  },
});
