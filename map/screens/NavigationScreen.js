// src/screens/NavigationScreen.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, PermissionsAndroid, Platform, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Callout } from 'react-native-maps';
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
import StepInstructionsModal from '../components/StepInstructionsModal';
import LaneGuidanceBar from '../components/LaneGuidanceBar';
import NextManeuverChip from '../components/NextManeuverChip';
import AddStopButton from '../components/AddStopButton';
import AddStopOverlay from '../components/AddStopOverlay';
import EditStopsOverlay from '../components/EditStopsOverlay2';
import { useNavigationLogic } from '../navigation/useNavigationLogic';
import useNavSim from '../navigation/useNavSim';
import useAltRoutes from '../navigation/useAltRoutes';
import useNavPOI from '../navigation/useNavPOI';
import { distanceToPolylineMeters } from '../navigation/navMath';
import { focusOn } from '../navigation/cameraUtils';
import {
  metersBetween as getDistanceMeters,
  distanceToPolylineMeters as distanceToRoute,
  closestPointOnPolyline,
} from '../navigation/navMath';
import useSafePolyline from '../navigation/useSafePolyline';
import useTurnByTurn from '../navigation/useTurnByTurn';
import { metersFmt, formatDurationShort, formatETA, formatAltComparison } from '../navigation/navFormatters';

/* -------------------------- Yardımcı Fonksiyonlar -------------------------- */

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
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

// const getDistanceMeters = (...) -> kaldırıldı
const getStepDistanceValue = (step) => {
  if (!step) return null;
  if (typeof step.distance === 'number') return step.distance;
  if (typeof step.distance?.value === 'number') return step.distance.value;
  return null;
};
const getStepDurationValue = (step) => {
  if (!step) return null;
  if (typeof step.duration === 'number') return step.duration;
  if (typeof step.duration?.value === 'number') return step.duration.value;
  return null;
};

const normalizeDeg180 = (deg) => {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

const getManeuverTarget = (step) => {
  if (!step) return null;

  const m = step.maneuver;
  if (Array.isArray(m?.location) && m.location.length === 2) {
    return { lat: m.location[1], lng: m.location[0] };
  }

  if (step.geometry?.type === 'LineString' && Array.isArray(step.geometry.coordinates)) {
    const last = step.geometry.coordinates[step.geometry.coordinates.length - 1];
    if (Array.isArray(last) && last.length >= 2) return { lat: last[1], lng: last[0] };
  }

  if (step.end_location && typeof step.end_location.lat === 'number' && typeof step.end_location.lng === 'number') {
    return { lat: step.end_location.lat, lng: step.end_location.lng };
  }

  const pl = step.polyline?.points || step.polyline || step.geometry;
  if (pl) {
    try {
      const pts = decodePolyline(pl);
      const last = pts?.[pts.length - 1];
      if (last) return { lat: last.latitude ?? last.lat, lng: last.longitude ?? last.lng };
    } catch {}
  }
  return null;
};

const formatInstructionTR = (step) => {
  if (!step) return '';
  const m = step.maneuver || {};
  const base = typeof m.instruction === 'string' && m.instruction.length > 0 ? m.instruction : '';
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

const formatInstructionRelativeTR = (headingDeg, step) => {
  if (!step) return '';
  const m = step.maneuver || {};
  const type = (m.type || '').toLowerCase();
  if (type === 'arrive') return 'Varış noktasına ulaştınız';

  const target = typeof m.bearing_after === 'number' ? m.bearing_after : null;
  if (headingDeg == null || Number.isNaN(headingDeg) || target == null) {
    return formatInstructionTR(step);
  }

  const delta = normalizeDeg180(target - headingDeg);
  const ad = Math.abs(delta);
  if (ad >= 165) return 'U dönüşü yapın';
  if (ad <= 15) return 'düz devam edin';
  if (ad < 45) return delta > 0 ? 'hafif sağa dönün' : 'hafif sola dönün';
  if (ad < 100) return delta > 0 ? 'sağa dönün' : 'sola dönün';
  return delta > 0 ? 'keskin sağa dönün' : 'keskin sola dönün';
};

const getTwoStageThresholds = (step, speedMps) => {
  const len = getStepDistanceValue(step) ?? 120;
  const pre = clamp(80, 140, len >= 220 ? 120 : 100);
  const v = Number.isFinite(speedMps) ? speedMps : 8;
  const timeBased = v * 3;
  const final = clamp(12, 35, Math.max(15, Math.min(35, timeBased)));
  return { pre, final };
};

const shortDirectiveTR = (headingDeg, step) => {
  const t = formatInstructionRelativeTR(headingDeg, step) || '';
  return t.replace(/^birazdan\s+/i, '').replace(/^düz devam edin$/i, 'düz devam edin');
};

const buzz = async () => {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
};

const calcRemaining = (stepsArr, idx, distToMan) => {
  if (!Array.isArray(stepsArr) || stepsArr.length === 0) return { dist: null, sec: null };
  let dist = 0, sec = 0;

  const cur = stepsArr[idx];
  if (cur) {
    const dCur = getStepDistanceValue(cur) ?? null;
    const sCur = getStepDurationValue(cur) ?? null;
    const remainD = Number.isFinite(distToMan) ? Math.max(0, distToMan) : dCur ?? 0;
    dist += remainD;
    if (sCur != null && dCur && dCur > 0) {
      sec += sCur * (remainD / dCur);
    }
  }
  for (let i = idx + 1; i < stepsArr.length; i++) {
    dist += getStepDistanceValue(stepsArr[i]) ?? 0;
    sec += getStepDurationValue(stepsArr[i]) ?? 0;
  }
  if (sec === 0 && dist > 0) sec = Math.round(dist / 12.5);
  return { dist, sec };
};

// [lng,lat] -> { latitude, longitude } yardımcıları (RN Maps Polyline için)
const toLatLng = ([lng, lat]) => ({ latitude: lat, longitude: lng });
const toLatLngArr = (coords = []) => coords.map(toLatLng);

// ✅ inline useSafePolyline kaldırıldı (ayrı dosyadan import)

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

  // ---- Refs ----
  const followBackSuppressedRef = useRef(false);
  const pendingOpRef = useRef(null);
  const replaceModeRef = useRef(false);
  const poiActiveRef = useRef({ type: null, query: null });
  const addStopOpenRef = useRef(false);
  const [addStopOpen, setAddStopOpen] = useState(false);

  // ---- State ----

  const [locationPermission, setLocationPermission] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const markerRefs = useRef(new Map());
  const setMarkerRef = useCallback((id, ref) => {
  if (!id) return;
  if (ref) markerRefs.current.set(id, ref);
  else markerRefs.current.delete(id);
}, []);

  const trendCountRef = useRef(0);
  const bearingOkCountRef = useRef(0);
  const lastStepIdxRef = useRef(-1);
  const speechHoldUntilRef = useRef(0);
  const routePairIdRef = useRef(0);

  const [isMapTouched, setIsMapTouched] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const [heading, setHeading] = useState(null);
  const headingRef = useRef(null);

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
  const [routes, setRoutes] = useState([]);

  const [navStarted, setNavStarted] = useState(false);
  const lastLocRef = useRef(null);

  const [dynamicRouteCoords, setDynamicRouteCoords] = useState([]);
  const [muted, setMuted] = useState(false);

  const speak = useCallback((text) => {
    if (!mutedRef.current) baseSpeak(text);
  }, []);
  const safeSpeak = (text, cooldownMs = 1500) => {
    const now = Date.now();
    if (now - lastSpeechAtRef.current < cooldownMs) return;
    lastSpeechAtRef.current = now;
    speak(text);
  };

  const toLngLat = (p) => {
    if (!p) return null;
    const lat = p.latitude ?? p.lat;
    const lng = p.longitude ?? p.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  };

  // ---- Rota koordinatları ----
  const baseRouteCoordinates = useMemo(() => {
    if (polyline) {
      return decodePolyline(polyline).map((c) => [c.longitude, c.latitude]); // [lng,lat]
    }
    const a = toLngLat(from);
    const b = toLngLat(to);
    return a && b ? [a, b] : [];
  }, [polyline, from, to]);

  const routeCoordinates = dynamicRouteCoords.length ? dynamicRouteCoords : baseRouteCoordinates;
  const rnPolyline = useMemo(
    () => (Array.isArray(routeCoordinates) ? routeCoordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) : []),
    [routeCoordinates]
  );
  const safePolylineCoords = useSafePolyline(routeCoordinates);

  // ---- Refs senk.
    useEffect(() => {
    addStopOpenRef.current = addStopOpen;
  }, [/* eslint-disable-line no-use-before-define */ addStopOpen]);
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const stepIndexRef = useRef(0);
  const routeCoordsRef = useRef([]);
  useEffect(() => { routeCoordsRef.current = routeCoordinates; }, [routeCoordinates]);
  const [pendingRouteMeta, setPendingRouteMeta] = useState(null);
  const [snapCoord, setSnapCoord] = useState(null);
  const [cameraCenter, setCameraCenter] = useState(null);

  // Durak ekleme (waypoints)
  const normalizeWp = (w) => {
    if (!w) return null;
    const lat = w.lat ?? w.latitude;
    const lng = w.lng ?? w.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat, lng,
      name: w.name || w.description || '',
      address: w.address || w.vicinity || '',
      place_id: w.place_id || w.id || null,
    };
  };

  const [waypoints, setWaypoints] = useState(
    Array.isArray(initialWaypoints)
      ? initialWaypoints.map(normalizeWp).filter(Boolean)
      : []
  );

  const waypointsRef = useRef(waypoints);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);

  // Kamera
  const DEFAULT_ZOOM = 18.8;
  const DEFAULT_PITCH = 52;
  const [camZoom, setCamZoom] = useState(DEFAULT_ZOOM);
  const [camPitch, setCamPitch] = useState(DEFAULT_PITCH);
  const camZoomRef = useRef(camZoom);
  const camPitchRef = useRef(camPitch);
  useEffect(() => { camZoomRef.current = camZoom; }, [camZoom]);
  useEffect(() => { camPitchRef.current = camPitch; }, [camPitch]);

  // MapView/camera adapter
  const mapRef = useRef(null);
  const minDistRef = useRef(null);
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

  useEffect(() => {
    if (!Array.isArray(initialWaypoints)) return;
    const mapped = initialWaypoints
      .map(w => {
        const lat = w.lat ?? w?.coords?.latitude ?? w?.latitude;
        const lng = w.lng ?? w?.coords?.longitude ?? w?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat, lng,
          name: w.name ?? null,
          place_id: w.place_id ?? null,
          address: w.address ?? null,
        };
      })
      .filter(Boolean);
    if (mapped.length) setWaypoints(mapped);
  }, [initialWaypoints]);
  // Flag ref sync
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const lastSpeechAtRef = useRef(0);
  useEffect(() => { headingRef.current = heading; }, [heading]);

  const {
  currentStepIndex,
  distanceToManeuver,
  liveRemain,
  speakBanner,
} = useTurnByTurn({
  steps,
  heading,
  location: nav?.location ?? null,       // useNavigationLogic'ten geliyor
  routeCoordsRef,               // mevcut ref'in
  speak,                        // senin baseSpeak wrap'in
  buzz,                         // haptik helper'ın
  helpers: {
    getDistanceMeters,          // NavigationScreen'de var
    getManeuverTarget,
    getStepDistanceValue,
    getStepDurationValue,
    formatInstructionTR,
    formatInstructionRelativeTR,
    shortDirectiveTR,
    getTwoStageThresholds,
    calcRemaining,
  },
  onArrive: () => speak('Varış noktasına ulaştınız.'),
});

  // Manevra yaklaşınca kamera yakınlaştır
  useEffect(() => {
    if (!isFollowing) return;
    const d = distanceToManeuver;
    let z = DEFAULT_ZOOM, p = DEFAULT_PITCH;
    if (Number.isFinite(d)) {
      if (d <= 50)      { z = 19.2; p = 60; }
      else if (d <= 160){ z = 18.9; p = 55; }
      else              { z = 18.6; p = 52; }
    }
    if (Math.abs(z - camZoomRef.current) > 0.02) setCamZoom(z);
    if (Math.abs(p - camPitchRef.current) > 0.5) setCamPitch(p);
  }, [distanceToManeuver, isFollowing]);

  // ---- Fetch route (başlangıç) ----
  const followHoldUntilRef = useRef(0);
  const pauseFollowing = useCallback((ms = 2500) => {
    followHoldUntilRef.current = Date.now() + ms;
  }, []);

  const isFollowingRef = useRef(true);
  useEffect(() => { isFollowingRef.current = isFollowing; }, [isFollowing]);

  const fetchRoute = useCallback(async () => {
    if (!from || !to) return;

    const res = await getRoute(toLL(from), toLL(to), mode, {
      waypoints,
      optimize: waypoints.length ? false : true,
      alternatives: true,
    });

    setRoutes(res || []);

    const best = res?.[0];
    const decoded = best?.decodedCoords || [];
    if (decoded.length && cameraRef.current?.fitBounds) {
      // 🔒 yalnızca aktif bir ekleme/yakın bakış yoksa fit
      if (
        !poiActiveRef.current.type &&
        !poiActiveRef.current.query &&
        !addStopOpenRef.current
      ) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        decoded.forEach((c) => {
          if (c.latitude < minLat) minLat = c.latitude;
          if (c.latitude > maxLat) maxLat = c.latitude;
          if (c.longitude < minLng) minLng = c.longitude;
          if (c.longitude > maxLng) maxLng = c.longitude;
        });
        pauseFollowing(1200);
        cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], 50, 500);
      }
    }
  }, [from, to, mode, waypoints, pauseFollowing]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);

  const primaryRoute = useMemo(() => {
    if (!routes.length) return null;
    return [...routes].sort((a, b) => (a.duration ?? 1e12) - (b.duration ?? 1e12))[0];
  }, [routes]);

  const distKm = primaryRoute?.distance ? (primaryRoute.distance / 1000).toFixed(1) : null;
  const durMin = primaryRoute?.duration ? Math.round(primaryRoute.duration / 60) : null;

  const recalcRoute = useCallback(
    async ({ originLat, originLng, keepSpeak = true, waypointsOverride } = {}) => {
      const origin =
        originLat != null && originLng != null
          ? { latitude: originLat, longitude: originLng }
          : lastLocRef.current
          ? { latitude: lastLocRef.current.latitude, longitude: lastLocRef.current.longitude }
          : { latitude: from.latitude, longitude: from.longitude };

      try {
        setIsRerouting(true);
        if (keepSpeak) await speak('Rota yeniden hesaplanıyor.');

        const wp = Array.isArray(waypointsOverride) ? waypointsOverride : waypointsRef.current;
        const opts = { alternatives: false, optimize: wp.length ? false : true };
        if (wp.length) opts.waypoints = wp.map((w) => ({ lat: w.lat, lng: w.lng, via: true }));

        const routesRes = await getRoute(toLL(origin), toLL(to), 'driving', opts);
        const primary = Array.isArray(routesRes) ? routesRes[0] : routesRes;
        if (!primary?.polyline && !primary?.geometry) throw new Error('Yeni rota alınamadı');

        let coords = [];
        if (primary?.geometry?.type === 'LineString' && Array.isArray(primary.geometry.coordinates)) {
          coords = primary.geometry.coordinates;
        } else if (primary?.polyline) {
          const decoded = decodePolyline(primary.polyline);
          coords = decoded.map((c) => [c.longitude, c.latitude]);
        }

        const meta = {
          dist: typeof primary.distance === 'number' ? primary.distance : null,
          sec: typeof primary.duration === 'number' ? primary.duration : null,
        };

        const rpId = beginRouteUpdate(coords, meta);

        let providerSteps = Array.isArray(primary.steps) ? primary.steps : [];
        if (!providerSteps.length) {
          const stepOrigin =
            origin && origin.latitude != null ? { lat: origin.latitude, lng: origin.longitude } : from;
          providerSteps = await getTurnByTurnSteps(stepOrigin, toLL(to));
        }

        finalizeRouteSteps(rpId, providerSteps);
      } catch (e) {
        await speak('Rota alınamadı.');
      } finally {
        setIsRerouting(false);
      }
    },
    [from, to, speak]
  );
  const [isRerouting, setIsRerouting] = useState(false);

  const onOffRoute = useCallback(async (user) => {
    setIsRerouting(true);
    try {
      await recalcRoute({
        originLat: user.latitude,
        originLng: user.longitude,
        keepSpeak: true,
      });
    } finally {
      setIsRerouting(false);
    }
  }, [recalcRoute]);

  const nav = useNavigationLogic({
    mapRef,
    routeCoords: rnPolyline,
    routeInfo: primaryRoute ? { distance: primaryRoute.distance, duration: primaryRoute.duration } : null,
    selectedMode: mode,
    offRouteThresholdM: 50,
    onOffRoute,            // 👈 önemli
    voice: !muted,
    externalFeed: true,
  });

  const {
  simActive, setSimActive,
  simSpeedKmh, setSimSpeedKmh,
  simCoord
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

  const beginRouteUpdate = (coords, meta = null) => {
    const id = ++routePairIdRef.current;
    setDynamicRouteCoords(coords);
    setPendingRouteMeta(meta);

    stepIndexRef.current = 0;

    setSpokenFlags({});
    spokenRef.current = {};
    lastSpeechAtRef.current = 0;
    speechHoldUntilRef.current = 0;
    lastStepIdxRef.current = -1;
    trendCountRef.current = 0;
    bearingOkCountRef.current = 0;
    minDistRef.current = null;
    setSnapCoord(null);
    setIsFollowing(true);
    return id;
  };

  const coordsFromSteps = (arr) => {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (const s of arr) {
      let seg = null;
      if (s?.geometry?.type === 'LineString' && Array.isArray(s.geometry.coordinates)) {
        seg = s.geometry.coordinates;
      } else if (Array.isArray(s?.geometry)) {
        seg = s.geometry;
      } else {
        const pl = s?.polyline?.points || s?.polyline;
        if (pl) {
          try {
            const pts = decodePolyline(pl).map((p) => [p.longitude ?? p.lng, p.latitude ?? p.lat]);
            seg = pts;
          } catch {}
        }
      }
      if (Array.isArray(seg) && seg.length) {
        if (out.length && out[out.length - 1][0] === seg[0][0] && out[out.length - 1][1] === seg[0][1]) {
          out.push(...seg.slice(1));
        } else {
          out.push(...seg);
        }
      }
    }
    return out;
  };

  const finalizeRouteSteps = (id, stepsArr, fallbackSteps = []) => {
    if (id !== routePairIdRef.current) return;
    const finalSteps = Array.isArray(stepsArr) && stepsArr.length ? stepsArr : fallbackSteps;
    const stitched = coordsFromSteps(finalSteps);
    if (stitched.length >= 2) setDynamicRouteCoords(stitched);
    setSteps(finalSteps);
    setPendingRouteMeta(null);
  };

  // İlk adımlardan rotayı doldur
  useEffect(() => {
    if (Array.isArray(steps) && steps.length) {
      const stitched = coordsFromSteps(steps);
      if (stitched.length >= 2) setDynamicRouteCoords(stitched);
    }
  }, [steps]);

  const followBackTimerRef = useRef(null);
  const scheduleFollowBack = useCallback(() => {
    if (followBackSuppressedRef.current) return;
    if (followBackTimerRef.current) clearTimeout(followBackTimerRef.current);
    followBackTimerRef.current = setTimeout(() => {
      if (followBackSuppressedRef.current) return;
      setIsFollowing(true);
      setIsMapTouched(false);
    }, 8000);
  }, []);
  useEffect(() => () => { if (followBackTimerRef.current) clearTimeout(followBackTimerRef.current); }, []);

  const mutedRefLocal = useRef(false);
  useEffect(() => { mutedRefLocal.current = muted; }, [muted]);

const activatedRef = useRef(false);

  useEffect(() => {
    if (mapReady && !activatedRef.current) {
      activatedRef.current = true;
      nav.activate?.();
    }
  // nav referansı her render’da değişse bile bir kez çalışsın
  }, [mapReady]);

  const prevSelectedIdRef = useRef(null);
useEffect(() => {
  const prev = prevSelectedIdRef.current;
  if (prev && prev !== selectedId) {
    markerRefs.current.get(prev)?.hideCallout?.();
  }

  let t;
  if (selectedId) {
    t = setTimeout(() => {
      markerRefs.current.get(selectedId)?.showCallout?.();
    }, 16);
  }

  prevSelectedIdRef.current = selectedId;
  return () => t && clearTimeout(t);
}, [selectedId]);

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

  const goFollowNow = useCallback(() => nav.recenter?.(), [nav]);

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
    const valid = from?.latitude != null && from?.longitude != null && to?.latitude != null && to?.longitude != null;

    if (!hasAnyGeometry && valid) {
      (async () => {
        try {
          const mSteps = await getTurnByTurnSteps(toLL(from), toLL(to));
          if (Array.isArray(mSteps) && mSteps.length > 0) setSteps(mSteps);
        } catch {}
      })();
    }
  }, [steps, from, to]);

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
    if (sec === 0 && dist > 0) sec = Math.round(dist / 12.5);
    return { dist, sec, totalSec };
  }, [steps, currentStepIndex]);

  const selectedPoiId = useMemo(() => {
    if (!candidateStop) return null;
    return candidateStop.place_id || candidateStop.id ||
      `${candidateStop.lng}_${candidateStop.lat}`;
  }, [/* eslint-disable-line no-use-before-define */ candidateStop]);

  const effSec = liveRemain?.sec ?? pendingRouteMeta?.sec ?? remaining.sec;
  const effDist = liveRemain?.dist ?? pendingRouteMeta?.dist ?? remaining.dist;
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
  }, [nav.totalM, nav.remainingM, effDist, primaryRoute?.distance]);

  useEffect(() => {
    if (!navStarted && steps && steps.length > 0) {
      setNavStarted(true);
      speak('Navigasyon başlatıldı.');
    }
  }, [steps, navStarted, speak]);

  const [spokenFlags, setSpokenFlags] = useState({});
  const spokenRef = useRef({});
  useEffect(() => { spokenRef.current = spokenFlags; }, [spokenFlags]);

  // ——— Durak düzenleme (EditStopsOverlay) ———
  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]);
  const [insertIndex, setInsertIndex] = useState(null);
  const insertIndexRef = useRef(null);
  useEffect(() => { insertIndexRef.current = insertIndex; }, [insertIndex]);
  const pendingInsertRef = useRef(null);

  const pendingOpRefLocal = pendingOpRef;
  const insertOrAppendStop = useCallback(({ lat, lng, name, place_id, address }) => {
  const payload = { lat, lng, place_id, name, address };
  focusOn(cameraRef, pauseFollowing, lng, lat, 18);
  const op = pendingOpRefLocal.current;
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

    pendingOpRefLocal.current = null;
    replaceModeRef.current = false;
    pendingInsertRef.current = null;
    insertIndexRef.current = null;
    setInsertIndex(null);
    setAddStopOpen(false);
    setEditStopsOpen(false);
    setSelectedId(null);
    setCandidateStop(null);
    clearPoi();
    setAddStopOpen(false);
    return;
  }

  setWaypoints(prev => {
    const next = [...prev, payload];
    recalcRoute({ keepSpeak: false, waypointsOverride: next });
    return next;
  });

  setSelectedId(null);
  setCandidateStop(null);
  clearPoi();
}, [insertIndex, pauseFollowing, recalcRoute, clearPoi]);

  const handlePickStop = useCallback(async (place) => {
  try {
    const pid = place?.place_id || place?.id;

    let lat = place?.geometry?.location?.lat
      ?? place?.location?.lat
      ?? place?.coords?.latitude
      ?? place?.lat;

    let lng = place?.geometry?.location?.lng
      ?? place?.location?.lng
      ?? place?.coords?.longitude
      ?? place?.lng;

    let name = place?.name || place?.structured_formatting?.main_text || place?.description || 'Seçilen yer';
    let address = place?.vicinity || place?.formatted_address || place?.secondary_text || place?.description || '';

    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && pid) {
      const d = await getPlaceDetails(pid);
      lat = d?.geometry?.location?.lat ?? lat;
      lng = d?.geometry?.location?.lng ?? lng;
      name = d?.name || name;
      address = d?.formatted_address || d?.vicinity || address;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    insertOrAppendStop({ lat, lng, name, place_id: pid, address });

    // 🔒 arama ile seçince overlay mutlaka kapansın
    setAddStopOpen(false);
  } catch {}
}, [insertOrAppendStop, getPlaceDetails]);

  const {
  altMode,
  altFetching,
  altRoutes,
  toggleAlternatives,
  applyAlternative,
} = useAltRoutes({
  from,
  to,
  waypointsRef,        // mevcut ref'in
  routeCoordsRef,      // mevcut ref'in
  lastLocRef,          // mevcut ref'in
  getRoute,
  decodePolyline,
  getTurnByTurnSteps,
  effSec,              // mevcut hesaplanan değer
  isAddingStop,        // POI/durak ekleme modunu engellemek için
  beginRouteUpdate,    // ekrandaki fonksiyonun
  finalizeRouteSteps,  // ekrandaki fonksiyonun
  safeSpeak,           // ekrandaki ses helper
});

const {
  poiActive,
  poiMarkers,
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
  routeCoordsRef,          // mevcut ref'in
  cameraRef,               // mevcut kamera adapter'in
  pauseFollowing,          // mevcut helper
  getNearbyPlaces,
  getPlaceDetails,
  onInsertStop: insertOrAppendStop,
  metersBetween: getDistanceMeters,
  distanceToPolylineMeters,
  addStopOpen,             // ekleme overlay'i açık mı?
});

  useEffect(() => {
    poiActiveRef.current = poiActive;
  }, [poiActive]);

  useEffect(() => {
    followBackSuppressedRef.current =
      addStopOpen || !!selectedId || !!candidateStop ||
      !!poiActive.type || !!poiActive.query;
  }, [addStopOpen, selectedId, candidateStop, poiActive]);
  // UI
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
        if (simActive) return; // sim açıkken gerçek GPS’i yoksay
        const c = e?.nativeEvent?.coordinate;
        if (c) nav.ingestExternalLocation?.({
          latitude: c.latitude,
          longitude: c.longitude,
          heading: c.heading,
          speed: c.speed,
        });
      }}

      onPress={() => {
        setIsMapTouched(true);
        nav.setUserInteracting?.(true);
        if (!followBackSuppressedRef.current) scheduleFollowBack();
      }}
      onPanDrag={() => {
        setIsMapTouched(true);
        setIsFollowing(false);
        nav.setUserInteracting?.(true);
        if (!followBackSuppressedRef.current) scheduleFollowBack();
      }}
      onRegionChangeComplete={(region) => {
        setCameraCenter({ latitude: region.latitude, longitude: region.longitude });
      }}
    >
      {/* Başlangıç */}
      {from && (
        <Marker coordinate={{ latitude: from.latitude, longitude: from.longitude }} />
      )}

      {/* Varış */}
      {to && (
        <Marker coordinate={{ latitude: to.latitude, longitude: to.longitude }} />
      )}

      {/* Aday durak */}
      {candidateStop && Number.isFinite(candidateStop.lat) && Number.isFinite(candidateStop.lng) && (
        <Marker coordinate={{ latitude: candidateStop.lat, longitude: candidateStop.lng }}>
          <View style={styles.candidateDotOuter}>
            <View style={styles.candidateDotInner} />
          </View>
        </Marker>
      )}

      {/* Waypoints */}
      {waypoints.map((w, idx) => (
        <Marker
          key={`wp_${idx}_${w.place_id || `${w.lat}_${w.lng}`}`}
          coordinate={{ latitude: w.lat, longitude: w.lng }}
        >
          <View style={styles.wpDotOuter}>
            <View style={styles.wpDotInner}>
              <Text style={styles.wpNum}>{idx + 1}</Text>
            </View>
          </View>
        </Marker>
      ))}

      {/* POI’ler */}
      {stablePoiList.map((p) => {
        const lat = p?.geometry?.location?.lat, lng = p?.geometry?.location?.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        const id = p.__id;

        return (
          <Marker
            ref={(r) => setMarkerRef(id, r)}
            key={`poi_${id}`}
            coordinate={{ latitude: lat, longitude: lng }}
            anchor={{ x: 0.5, y: 1 }}
            calloutAnchor={{ x: 0.5, y: 0 }}
            tracksViewChanges={false}
            zIndex={9999}
            onPress={(e) => {
              e?.stopPropagation?.();
              setSelectedId(id);
              onPoiPress(p);
            }}
            onCalloutPress={() => handleAddStopFromPOI(p)}
          >
            <View key={`pin_${id}`} collapsable={false} style={styles.poiDotOuter}>
              <Text style={styles.poiEmoji}>📍</Text>
            </View>

            <Callout key={`co_${id}`} tooltip={Platform.OS === 'ios'}>
              <View
                style={[
                  styles.calloutOuter,
                  Platform.OS === 'android' && { maxWidth: 440, minWidth: 300 },
                ]}
                collapsable={false}
              >
                <View
                  style={[
                    styles.calloutCard,
                    Platform.OS === 'android' && { maxWidth: 440, minWidth: 300 },
                  ]}
                >
                  <Text style={styles.calloutTitle} numberOfLines={1}>
                    {p?.name || 'Seçilen yer'}
                  </Text>
                  <Text style={styles.calloutSub} numberOfLines={1}>
                    {(p?.rating ? `★ ${p.rating} • ` : '') + (p?.vicinity || '')}
                  </Text>
                  <TouchableOpacity
                    style={styles.calloutCta}
                    onPress={() => handleAddStopFromPOI(p)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.calloutCtaText}>Durak ekle</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Callout>
          </Marker>
        );
      })}

      {/* Mavi aktif rota */}
      {safePolylineCoords.length > 1 && (
        <Polyline coordinates={safePolylineCoords} strokeWidth={6} strokeColor="#1E88E5" />
      )}

      {/* Gri alternatif rotalar */}
      {altMode &&
        !altFetching &&
        !isAddingStop &&
        altRoutes.map((r) => (
          <Polyline
            key={`alt_${r.id}`}
            coordinates={toLatLngArr(r.coords)}
            strokeWidth={4}
            strokeColor="#777"
            lineDashPattern={[6, 6]}
            tappable
            onPress={() => applyAlternative(r)}
          />
        ))}

      {/* Alternatif rota etiketleri */}
      {altMode &&
        !altFetching &&
        !isAddingStop &&
        altRoutes.map((r) => {
          const baselineSec = effSec;
          const midIdx = Math.floor(r.coords.length / 2);
          const mid = r.coords[midIdx] || r.coords[0];
          const cmp = formatAltComparison(baselineSec, r.duration);
          const label = cmp.text;
          const tone = cmp.tone;
          return (
            <Marker key={`alt_label_${r.id}`} coordinate={{ latitude: mid[1], longitude: mid[0] }}>
              <TouchableOpacity onPress={() => applyAlternative(r)} activeOpacity={0.8}>
                <View style={[styles.altLabel, styles[`alt_${tone}`]]}>
                  <Text style={[styles.altLabelText, styles[`altText_${tone}`]]}>{label}</Text>
                </View>
              </TouchableOpacity>
            </Marker>
          );
        })}

      {/* Simülasyon kullanıcı noktası */}
      {simActive && simCoord && (
        <Marker coordinate={{ latitude: simCoord.lat, longitude: simCoord.lng }}>
          <View style={styles.simUserDotOuter}>
            <View style={styles.simUserDotInner} />
          </View>
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
      <View style={styles.rerouteBadge}>
        <Text style={styles.rerouteText}>Rota güncelleniyor…</Text>
      </View>
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

      <TouchableOpacity
        style={styles.actionBtn}
        onPress={() => {
          Speech.stop();
          setMuted((m) => !m);
        }}
      >
        <Text style={styles.actionIcon}>{muted ? '🔇' : '🔊'}</Text>
      </TouchableOpacity>
    </View>

    {/* Üst banner */}
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.banner}
      onPress={speakBanner}
    >
      <View style={styles.bannerStack}>
        <LaneGuidanceBar step={steps?.[currentStepIndex]} iconsOnly style={{ marginBottom: 6 }} />
        <Text style={styles.bannerTitle}>
          {formatInstructionRelativeTR(heading, steps?.[currentStepIndex])}
          {distanceToManeuver != null ? ` • ${metersFmt(distanceToManeuver)}` : ''}
        </Text>
      </View>

      {!!steps?.[currentStepIndex + 1] && (
        <NextManeuverChip
          step={steps[currentStepIndex + 1]}
          distance={getStepDistanceValue(steps[currentStepIndex + 1])}
        />
      )}
    </TouchableOpacity>

    {distKm && durMin && (
      <View style={styles.infoBar}>
        <Text style={styles.infoText}>
          {durMin} dk • {distKm} km
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
            {remainDistStr} • {remainDurStr}
            {waypoints.length ? ` • ${waypoints.length} durak` : ''}
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
            onPress={() => {
              Speech.stop();
              setSimActive(false);
              navigation.goBack();
            }}
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
      onAddStop={(p) => { handleAddStopFromPOI(p); setAddStopOpen(false); }}
      routeBounds={poiActive?.type ? getRouteBounds() : null}
    />

    {/* Durakları düzenle */}
    <EditStopsOverlay
      visible={editStopsOpen}
      stops={draftStops}
      onClose={() => {
        setEditStopsOpen(false);
        setDraftStops([]);
        setInsertIndex(null);
      }}
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
      onDragEnd={(fromIdx, toIdx) =>
        setDraftStops((prev) => {
          if (fromIdx === toIdx) return prev;
          const next = [...prev];
          const [it] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, it);
          return next;
        })
      }
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

  calloutOuter: {
    shadowOpacity: 0.12, shadowRadius: 8, shadowOffset:{width:0,height:4},
    elevation: 4,
  },
  infoText: { color: '#fff', fontWeight: '700' },
  poiDotOuter: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 6,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  poiEmoji: { fontSize: 16 },
  calloutCard: {
    minWidth: 280,
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  calloutTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  calloutSub: { marginTop: 6, fontSize: 13, color: '#555' },
  calloutCta: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#E6F4EA',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  calloutCtaText: { fontSize: 13, fontWeight: '700', color: '#111' },

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

  altLabel: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  altLabelText: { fontSize: 12, fontWeight: '700', color: '#1E88E5' },
  alt_faster: { backgroundColor: '#E6F4EA', borderColor: '#A8D5B8' },
  alt_slower: { backgroundColor: '#FDECEA', borderColor: '#F5C2C0' },
  alt_neutral: { backgroundColor: 'white', borderColor: '#ddd' },
  altText_faster: { color: '#1E7E34' },
  altText_slower: { color: '#B42318' },
  altText_neutral: { color: '#1E88E5' },

  topControls: { position: 'absolute', top: Platform.OS === 'ios' ? 110 : 80, right: 12, flexDirection: 'row', zIndex: 50 },
  topBtn: { marginLeft: 8, backgroundColor: 'white', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, elevation: 6 },
  topBtnActive: { backgroundColor: '#E8F1FF' },
  topBtnDisabled: { opacity: 0.4 },
  topBtnIcon: { fontSize: 18 },

  // Waypoint pinleri
  wpDotOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.5)',
  },
  wpDotInner: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFC107',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  wpNum: { fontSize: 11, fontWeight: '700', color: '#111' },

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
