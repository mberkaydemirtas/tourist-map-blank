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

/* -------------------------- Yardımcı Fonksiyonlar -------------------------- */

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const toLL = (p) => {
  if (!p) return null;
  const lat = p.lat ?? p.latitude;
  const lng = p.lng ?? p.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const bearingDeg = (a, b) => {
  const φ1 = (a.lat * Math.PI) / 180,
    φ2 = (b.lat * Math.PI) / 180;
  const λ1 = (a.lng * Math.PI) / 180,
    λ2 = (b.lng * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
};

const poiIdOf = (p) =>
  p?.place_id || p?.id ||
  `${p?.geometry?.location?.lng}_${p?.geometry?.location?.lat}`;

const baseSpeak = async (text) => {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'tr-TR', pitch: 1.0, rate: 1.0 });
  } catch {}
};


const destinationPoint = (lat, lng, bearingDegV, distM) => {
  const R = 6371e3, δ = distM / R;
  const θ = (bearingDegV * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  let λ2 = λ1 + Math.atan2(y, x);
  λ2 = ((λ2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
};

const computeLookAhead = (zoom, speedMps, distToManeuver) => {
  const v = Number.isFinite(speedMps) ? speedMps : 8;
  const z = Number.isFinite(zoom) ? zoom : 17.5;
  let ahead = 60 + v * 6 + Math.max(0, 18 - z) * 30;
  if (Number.isFinite(distToManeuver)) ahead = Math.min(ahead, Math.max(60, distToManeuver * 0.6));
  return clamp(60, 300, Math.round(ahead));
};

const metersFmt = (m) => {
  if (m == null || Number.isNaN(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 2000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(1, Math.round(m))} m`;
};


// ✅ Haversine (atan2(√a, √(1−a)))
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

const normalizeDeg360 = (deg) => ((deg % 360) + 360) % 360;
const smoothAngle = (prev, next, alpha = 0.22) => {
  if (prev == null) return normalizeDeg360(next);
  const delta = normalizeDeg180(next - prev);
  return normalizeDeg360(prev + alpha * delta);
};

const nextPreviewText = (step) => {
  if (!step) return '';
  const t = formatInstructionTR(step);
  const d = getStepDistanceValue(step);
  return d != null ? `${t} • ${metersFmt(d)}` : t;
};

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
  const typeMap = { turn: '↪️', new_name: '⬆️', continue: '⬆️', depart: '▶️', end_of_road: '⬅️', on_ramp: '↗️', off_ramp: '↘️' };
  return typeMap[type] || '⬆️';
};

const getHeadingRelativeIcon = (headingDeg, step) => {
  const m = step?.maneuver || {};
  const type = (m.type || '').toLowerCase();
  if (type === 'arrive') return '🏁';
  const target = typeof m.bearing_after === 'number' ? m.bearing_after : null;
  if (headingDeg == null || Number.isNaN(headingDeg) || target == null) return getModifierIcon(step);
  const delta = normalizeDeg180(target - headingDeg);
  const ad = Math.abs(delta);
  if (ad >= 165) return delta > 0 ? '↪️' : '↩️';
  if (ad <= 15) return '⬆️';
  if (ad < 45) return delta > 0 ? '↗️' : '↖️';
  if (ad < 100) return delta > 0 ? '➡️' : '⬅️';
  return delta > 0 ? '↘️' : '↙️';
};

const toXY = (lat, lng, lat0) => {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return { x: lng * mPerDegLng, y: lat * mPerDegLat };
};
const fromXY = (x, y, lat0) => {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return { lat: y / mPerDegLat, lng: x / mPerDegLng };
};
const pointToSegmentFoot = (P, A, B, lat0) => {
  const p = toXY(P.lat, P.lng, lat0);
  const a = toXY(A.lat, A.lng, lat0);
  const b = toXY(B.lat, B.lng, lat0);
  const ABx = b.x - a.x, ABy = b.y - a.y;
  const APx = p.x - a.x, APy = p.y - a.y;
  const ab2 = ABx * ABx + ABy * ABy || 1;
  let t = (APx * ABx + APy * ABy) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * ABx, cy = a.y + t * ABy;
  const C = fromXY(cx, cy, lat0);
  const dist = Math.hypot(p.x - cx, p.y - cy);
  return { dist, point: C, t };
};

const distanceToRoute = (user, coords) => {
  if (!coords || coords.length < 2) return Infinity;
  const lat0 = user.lat;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const A = { lat: coords[i][1], lng: coords[i][0] };
    const B = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const { dist } = pointToSegmentFoot(user, A, B, lat0);
    if (dist < best) best = dist;
    if (best < 5) break;
  }
  return best;
};

const closestPointOnRoute = (user, coords) => {
  if (!coords || coords.length < 2) return { dist: Infinity, point: null };
  const lat0 = user.lat;
  let best = { dist: Infinity, point: null };
  for (let i = 0; i < coords.length - 1; i++) {
    const A = { lat: coords[i][1], lng: coords[i][0] };
    const B = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const r = pointToSegmentFoot(user, A, B, lat0);
    if (r.dist < best.dist) best = r;
    if (best.dist < 5) break;
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

const formatAltComparison = (baseSec, altSec) => {
  if (!Number.isFinite(baseSec) || !Number.isFinite(altSec)) return { text: '—', tone: 'neutral' };
  const diff = Math.round(altSec - baseSec);
  const ad = Math.abs(diff);
  if (ad < 45) return { text: 'aynı süre', tone: 'neutral' };
  const mins = Math.max(1, Math.round(ad / 60));
  return diff < 0 ? { text: `${mins} dk daha hızlı`, tone: 'faster' } : { text: `${mins} dk daha yavaş`, tone: 'slower' };
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

// === Konuşma kuyruğu / bekleme ===
const SPEECH_MIN_GAP_MS = 2000;
const NEXT_STEP_DELAY_MS = 2000;
const TAIL_SILENCE_MS = 400;

const estimateSpeechMs = (text) => {
  const w = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return clamp(900, 4500, Math.round((w / 2.5) * 1000));
};

// [lng,lat] -> { latitude, longitude } yardımcıları (RN Maps Polyline için)
const toLatLng = ([lng, lat]) => ({ latitude: lat, longitude: lng });
const toLatLngArr = (coords = []) => coords.map(toLatLng);
// Polyline güvenliği: yalnızca sayısal noktaları geçir
const useSafePolyline = (coords) => {
  return useMemo(() => {
    const arr = toLatLngArr(coords)
      .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    // ardışık aynı noktaları at → bazı sürümlerde çizim hatasını tetikler
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const prev = out[out.length - 1];
      const cur = arr[i];
      if (!prev || prev.latitude !== cur.latitude || prev.longitude !== cur.longitude) {
        out.push(cur);
      }
    }
    return out;
  }, [coords]);
};
const arrayMove = (arr, from, to) => {
  const a = [...arr];
  const item = a.splice(from, 1)[0];
  a.splice(to, 0, item);
  return a;
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
    waypoints: initialWaypoints = [],           // 👈 MapScreen'den gelebilir veya gelmeyebilir
  } = route.params ?? {};

  // ---- Refs ----
  const followBackSuppressedRef = useRef(false);
  const pendingOpRef = useRef(null);
  const candidateStopRef = useRef(null);
  const replaceModeRef = useRef(false);
  const poiActiveRef = useRef({ type: null, query: null });
  const addStopOpenRef = useRef(false);

  // ---- State ----
  const [poiMarkers, setPoiMarkers] = useState([]);
  const [poiActive, setPoiActive] = useState({ type: null, query: null });

  const [liveRemain, setLiveRemain] = useState({ dist: null, sec: null });
  const [locationPermission, setLocationPermission] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);

  const [altMode, setAltMode] = useState(false);
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

  const camHeadingRef = useRef(null);
  const [navStarted, setNavStarted] = useState(false);
  const [distanceToManeuver, setDistanceToManeuver] = useState(null);
  const [isRerouting, setIsRerouting] = useState(false);
  const offRouteCountRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const lastLocRef = useRef(null);
  const hasFirstFixRef = useRef(false);

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

  const [selectedId, setSelectedId] = useState(null);
  const isAddingStop = useMemo(
    () => addStopOpen || !!selectedId || !!candidateStop || !!poiActive.type || !!poiActive.query,
    // eslint-disable-next-line no-use-before-define
    [addStopOpen, selectedId, candidateStop, poiActive]
  );

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
  const safePolylineCoords = useSafePolyline(routeCoordinates);
  const stablePoiList = useMemo(() => {
    const arr = Array.isArray(poiMarkers) ? poiMarkers : [];
    return arr
      .map(p => ({ ...p, __id: poiIdOf(p) }))
      .sort((a, b) => (a.__id > b.__id ? 1 : -1));
  }, [poiMarkers]);

  const clearPoi = useCallback(() => {
    setPoiActive({ type: null, query: null });
    setPoiMarkers([]);
    setSelectedId(null);

    // 🔒 Aday durak varsa rotaya fit ETME
    if (candidateStopRef.current) return;

    if (routeCoordinates.length >= 2 && cameraRef.current?.fitBounds) {
      pauseFollowing(1200);
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      for (const [lng, lat] of routeCoordinates) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], 50, 500);
    }
  }, [routeCoordinates]);

  // ---- Refs senk.
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
  ); // 👈 boş gelse de sorun yok

  const waypointsRef = useRef(waypoints);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);

  const wpConsumedAtRef = useRef(0);

  // Kamera
  const DEFAULT_ZOOM = 18.8;
  const DEFAULT_PITCH = 52;
  const CAMERA_ANIM_MS = 110;
  const HEADING_SMOOTH_ALPHA = 0.45;
  const HEADING_SNAP_DEG = 60;
  const [camZoom, setCamZoom] = useState(DEFAULT_ZOOM);
  const [camPitch, setCamPitch] = useState(DEFAULT_PITCH);
  const camZoomRef = useRef(camZoom);
  const camPitchRef = useRef(camPitch);
  useEffect(() => { camZoomRef.current = camZoom; }, [camZoom]);
  useEffect(() => { camPitchRef.current = camPitch; }, [camPitch]);

  // MapView/camera adapter
  const getDistanceToMeters = (a, b) => getDistanceMeters(a, b);
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

  useEffect(() => {
    addStopOpenRef.current = addStopOpen;
  }, [/* eslint-disable-line no-use-before-define */ addStopOpen]);

  useEffect(() => {
    candidateStopRef.current = candidateStop;
  }, [/* eslint-disable-line no-use-before-define */ candidateStop]);

  useEffect(() => {
    poiActiveRef.current = poiActive;
  }, [poiActive]);

  useEffect(() => {
    followBackSuppressedRef.current =
      addStopOpen || !!selectedId || !!candidateStop ||
      !!poiActive.type || !!poiActive.query;
  }, [/* eslint-disable-line no-use-before-define */ addStopOpen, selectedId, candidateStop, poiActive]);

  // Alternatifleri kapat: durak eklerken
  useEffect(() => {
    if (isAddingStop && altMode) {
      setAltMode(false);
      setAltRoutes([]);
    }
  }, [isAddingStop, altMode]);

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
  const pauseFollowing = useCallback((ms = 2500) => {
    followHoldUntilRef.current = Date.now() + ms;
  }, []);
  const clearFollowHold = useCallback(() => { followHoldUntilRef.current = 0; }, []);
  const followHoldUntilRef = useRef(0);
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
        !candidateStopRef.current &&
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

  const beginRouteUpdate = (coords, meta = null) => {
    const id = ++routePairIdRef.current;
    setDynamicRouteCoords(coords);
    setPendingRouteMeta(meta);

    setCurrentStepIndex(0);
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

    setDistanceToManeuver(null);
    setLiveRemain({ dist: meta?.dist ?? null, sec: meta?.sec ?? null });
    setIsFollowing(true);

    setAltMode(false);
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

  // ---- Simülasyon / Alternatif rota vs... (kalan kısım mevcut koddaki gibi) ----

  const speedEstRef = useRef({ t: 0, lat: null, lng: null, v: null });
  const completionThreshold = (step) => {
    const stepLen = getStepDistanceValue(step) ?? 80;
    const target = Math.round(Math.min(28, Math.max(12, stepLen * 0.25)));
    return target;
  };
  const sayQueued = (text, { delayMs = 0, minGapMs = SPEECH_MIN_GAP_MS } = {}) => {
    const now = Date.now();
    const wait = Math.max(
      delayMs,
      lastSpeechAtRef.current + minGapMs - now,
      speechHoldUntilRef.current - now,
      0
    );
    setTimeout(() => {
      lastSpeechAtRef.current = Date.now();
      const dur = estimateSpeechMs(text);
      speechHoldUntilRef.current = Date.now() + dur + TAIL_SILENCE_MS;
      speak(text);
    }, wait);
  };

  const mutedRefLocal = useRef(false);
  useEffect(() => { mutedRefLocal.current = muted; }, [muted]);

  const onPoiPress = useCallback(
    async (it) => {
      const pid = it?.place_id || it?.id;
      const fLat = it?.geometry?.location?.lat;
      const fLng = it?.geometry?.location?.lng;
      setCandidateStop({
        lat: fLat, lng: fLng,
        name: it?.name || 'Seçilen yer',
        place_id: pid,
        rating: it?.rating ?? null,
        openNow: it?.opening_hours?.open_now ?? null,
        address: it?.vicinity || '',
      });
      focusOn(fLng, fLat, 18);
      try {
        if (pid) {
          const detail = await getPlaceDetails(pid);
          if (detail) {
            const dLat = detail?.geometry?.location?.lat ?? fLat;
            const dLng = detail?.geometry?.location?.lng ?? fLng;
            setCandidateStop(prev =>
              prev && prev.place_id === pid
                ? {
                    ...prev,
                    lat: dLat, lng: dLng,
                    name: detail?.name || prev.name,
                    rating: detail?.rating ?? prev.rating,
                    openNow: detail?.opening_hours?.open_now ?? prev.openNow,
                    address: detail?.formatted_address || detail?.vicinity || prev.address,
                  }
                : prev
            );
          }
        }
      } catch {}
    },
    [/* focusOn defined below */]
  );

  const [simActive, setSimActive] = useState(false);
  const simActiveRef = useRef(false);
  useEffect(() => { simActiveRef.current = simActive; }, [simActive]);
  const [simSpeedKmh, setSimSpeedKmh] = useState(30);
  const [simCoord, setSimCoord] = useState(null);
  const simTimerRef = useRef(null);
  const simStateRef = useRef({ i: 0, t: 0 });

  const [altFetching, setAltFetching] = useState(false);
  const [altRoutes, setAltRoutes] = useState([]);

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

  const goFollowNow = useCallback(() => {
    const loc = lastLocRef.current;
    if (!loc || !cameraRef.current) return;

    setIsFollowing(true);
    setIsMapTouched(false);
    clearFollowHold();

    const rawHdg =
      typeof camHeadingRef.current === 'number'
        ? camHeadingRef.current
        : typeof headingRef.current === 'number'
        ? headingRef.current
        : typeof loc.heading === 'number' && loc.heading >= 0
        ? loc.heading
        : 0;

    const hdgWanted = normalizeDeg360(rawHdg);

    const v = speedEstRef.current?.v;
    computeLookAhead(camZoomRef.current, v, distanceToManeuver);

    try {
      const baseZoom = camZoomRef.current ?? DEFAULT_ZOOM;
      const targetZoom = clamp(14, 21, baseZoom - 0.8);
      setCamZoom(targetZoom);

      cameraRef.current.setCamera({
        centerCoordinate: [loc.longitude, loc.latitude],
        heading: hdgWanted,
        pitch: camPitchRef.current,
        zoom: targetZoom,
        animationDuration: CAMERA_ANIM_MS,
      });
    } catch {}
  }, [clearFollowHold, distanceToManeuver]);

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

  const rerouteFromHere = async (userLat, userLng) => {
    const now = Date.now();
    if (isRerouting || now - lastRerouteAtRef.current < 15000) return;
    lastRerouteAtRef.current = now;
    await recalcRoute({ originLat: userLat, originLng: userLng, keepSpeak: true });
  };

  const SAMPLE_EVERY_M = 900;
  const NEARBY_RADIUS_M = 650;

  const flyToItemsBounds = useCallback((items) => {
    if (!cameraRef.current) return;

    if (Array.isArray(items) && items.length === 1) {
      const it = items[0];
      const lat = it?.geometry?.location?.lat ?? it?.lat ?? it?.coords?.latitude;
      const lng = it?.geometry?.location?.lng ?? it?.lng ?? it?.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        pauseFollowing(1800);
        try {
          cameraRef.current.setCamera({ centerCoordinate: [lng, lat], animationDuration: 350 });
        } catch {}
      }
      return;
    }

    if (Array.isArray(items) && items.length > 1) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = 180 * -1;
      for (const it of items) {
        const lat = it?.geometry?.location?.lat ?? it?.lat ?? it?.coords?.latitude;
        const lng = it?.geometry?.location?.lng ?? it?.lng ?? it?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      if (minLat <= maxLat && minLng <= maxLng) {
        pauseFollowing(2200);
        try {
          cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], 60, 500);
        } catch {}
        return;
      }
    }

    if (routeCoordinates.length >= 2 && !candidateStopRef.current) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      for (const [lng, lat] of routeCoordinates) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      pauseFollowing(1500);
      try {
        cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], 50, 500);
      } catch {}
      return;
    }
  }, [routeCoordinates, pauseFollowing]);

  const fetchPlacesAlongRoute = useCallback(
    async ({ type = null, text = null, noCorridor = false } = {}) => {
      if (!routeCoordsRef.current || routeCoordsRef.current.length < 2) {
        setPoiMarkers([]);
        return;
      }

      const coords = routeCoordsRef.current; // [lng, lat]
      const samples = [];
      let acc = 0;

      for (let i = 0; i < coords.length - 1; i++) {
        const A = { lat: coords[i][1], lng: coords[i][0] };
        const B = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
        const seg = getDistanceMeters(A, B);
        if (acc === 0) samples.push(A);
        acc += seg;
        while (acc >= SAMPLE_EVERY_M) {
          acc -= SAMPLE_EVERY_M;
          const t = (seg - acc) / seg;
          const lat = A.lat + (B.lat - A.lat) * t;
          const lng = A.lng + (B.lng - A.lng) * t;
          samples.push({ lat, lng });
        }
      }
      samples.push({ lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] });

      const seen = new Map();

      for (const s of samples) {
        try {
          const res = await getNearbyPlaces({
            location: { lat: s.lat, lng: s.lng },
            radius: NEARBY_RADIUS_M,
            type: type || undefined,
            keyword: text || undefined,
          });
          if (Array.isArray(res)) {
            for (const it of res) {
              const id = it.place_id || it.id;
              const lat = it?.geometry?.location?.lat;
              const lng = it?.geometry?.location?.lng;
              if (!id || typeof lat !== 'number' || typeof lng !== 'number') continue;
              if (seen.has(id)) continue;

              if (!!type && !noCorridor) {
                const d = distanceToRoute({ lat, lng }, routeCoordsRef.current);
                const corridorSlack = Math.max(NEARBY_RADIUS_M + 500, 1200);
                if (!Number.isFinite(d) || d > corridorSlack) continue;
              }
              seen.set(id, it);
            }
          }
        } catch {}
      }

      const list = Array.from(seen.values()).slice(0, 40);
      setPoiMarkers(list);
      flyToItemsBounds(list);
    },
    [flyToItemsBounds]
  );

  const focusOn = useCallback(
    (lng, lat, zoom = 17.5) => {
      if (!cameraRef.current) return;
      try {
        setIsFollowing(false);
        setIsMapTouched(true);
        pauseFollowing(8000);

        cameraRef.current.setCamera({
          centerCoordinate: [lng, lat],
          zoom,
          animationDuration: 450,
        });
      } catch {}
    },
    [pauseFollowing]
  );

  const handleNavCategorySelect = useCallback(
    async (type) => {
      setPoiActive({ type, query: null });
      await fetchPlacesAlongRoute({ type, noCorridor: false });
    },
    [fetchPlacesAlongRoute]
  );

  const handleQuerySubmit = useCallback(
    async (text) => {
      setPoiActive({ type: null, query: text });
      await fetchPlacesAlongRoute({ text, noCorridor: true });
    },
    [fetchPlacesAlongRoute]
  );

  const ingestLocation = (source, loc) => {
    if (simActiveRef.current && source !== 'sim') return;
    if (!loc?.coords) return;

    const now = Date.now();
    const { latitude, longitude, heading: sensorHdg } = loc.coords;

    const prevFix = speedEstRef.current;
    const hasPrev = prevFix?.lat != null && prevFix?.lng != null && prevFix?.t;
    const dt = hasPrev ? (now - prevFix.t) / 1000 : null;
    const moved = hasPrev
      ? getDistanceMeters({ lat: prevFix.lat, lng: prevFix.lng }, { lat: latitude, lng: longitude })
      : 0;

    let v =
      typeof loc.coords.speed === 'number' && isFinite(loc.coords.speed) && loc.coords.speed >= 0
        ? loc.coords.speed
        : hasPrev && dt > 0.2
        ? moved / Math.max(0.2, dt)
        : null;

    let courseDeg = null;
    if (hasPrev && dt > 0.4 && moved > 0.8) {
      courseDeg = bearingDeg({ lat: prevFix.lat, lng: prevFix.lng }, { lat: latitude, lng: longitude });
    }
    if (courseDeg == null && typeof sensorHdg === 'number' && sensorHdg >= 0) courseDeg = sensorHdg;
    if (courseDeg == null && typeof headingRef.current === 'number') courseDeg = headingRef.current;

    if (courseDeg != null) setHeading(courseDeg);

    if (
      isFollowingRef.current &&
      now >= followHoldUntilRef.current &&
      cameraRef.current &&
      courseDeg != null
    ) {
      const hWanted = normalizeDeg360(courseDeg);
      const prevH = camHeadingRef.current ?? hWanted;
      const delta = Math.abs(normalizeDeg180(hWanted - prevH));
      const smoothH = delta > HEADING_SNAP_DEG ? hWanted : smoothAngle(prevH, hWanted, HEADING_SMOOTH_ALPHA);
      camHeadingRef.current = smoothH;

      try {
        if (mapready) {
          cameraRef.current?.setCamera({
            centerCoordinate: [longitude, latitude],
            heading: smoothH,
            pitch: camPitchRef.current,
            zoom: camZoomRef.current,
            animationDuration: CAMERA_ANIM_MS,
          });
        }
      } catch {}
    }

    if (!hasFirstFixRef.current) {
      setIsFollowing(true);
      hasFirstFixRef.current = true;
    }

    speedEstRef.current = { t: now, lat: latitude, lng: longitude, v };
    lastLocRef.current = loc.coords;

    if (Array.isArray(waypointsRef.current) && waypointsRef.current.length > 0) {
      const first = waypointsRef.current[0];
      const dToFirst = getDistanceMeters(
        { lat: loc.coords.latitude, lng: loc.coords.longitude },
        { lat: first.lat, lng: first.lng }
      );
      const now2 = Date.now();
      if (Number.isFinite(dToFirst) && dToFirst <= 60 && now2 - wpConsumedAtRef.current > 4000) {
        wpConsumedAtRef.current = now2;
        setWaypoints((prev) => prev.slice(1));
        recalcRoute({
          originLat: loc.coords.latitude,
          originLng: loc.coords.longitude,
          keepSpeak: false,
        });
        return;
      }
    }

    const user = { lat: latitude, lng: longitude };
    if (routeCoordsRef.current.length >= 2 && !simActiveRef.current) {
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      const vEff = Number.isFinite(v) ? v : 12.5;
      const OFF_ROUTE_THRESHOLD = clamp(25, 80, vEff * 3);
      const OFF_ROUTE_CONSEC = 2;

      if (Number.isFinite(dRoute)) {
        if (dRoute > OFF_ROUTE_THRESHOLD) offRouteCountRef.current += 1;
        else offRouteCountRef.current = Math.max(0, offRouteCountRef.current - 1);

        if (offRouteCountRef.current >= OFF_ROUTE_CONSEC) {
          offRouteCountRef.current = 0;
          rerouteFromHere(latitude, longitude);
          return;
        }
      }
    }

    if (routeCoordsRef.current.length >= 2) {
      const cp = closestPointOnRoute(user, routeCoordsRef.current);
      if (Number.isFinite(cp.dist) && cp.dist <= 60) setSnapCoord(cp.point);
      else setSnapCoord(null);
    } else setSnapCoord(null);

    const curSteps = stepsRef.current;
    if (!curSteps || curSteps.length === 0) {
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      if (Number.isFinite(dRoute)) setDistanceToManeuver(dRoute);
      return;
    }

    const idx = Math.min(stepIndexRef.current, curSteps.length - 1);
    if (idx !== lastStepIdxRef.current) {
      lastStepIdxRef.current = idx;
      trendCountRef.current = 0;
      bearingOkCountRef.current = 0;
      minDistRef.current = null;
    }
    const step = curSteps[idx];
    const t = getManeuverTarget(step);

    if (t) {
      const dist = getDistanceMeters(user, t);
      setDistanceToManeuver(dist);
      const dyn = calcRemaining(curSteps, idx, dist);
      setLiveRemain(dyn);

      const stepLen = getStepDistanceValue(step) ?? 80;
      const doneAt = completionThreshold(step);

      if (dist != null) {
        if (minDistRef.current == null || dist < minDistRef.current) {
          minDistRef.current = dist;
        }
      }

      const key = String(idx);
      const flags = spokenRef.current[key] || { pre: false, final: false, done: false };
      const h = typeof sensorHdg === 'number' && sensorHdg >= 0 ? sensorHdg : headingRef.current;
      const vNow = speedEstRef.current.v;
      const useRelative = Number.isFinite(vNow) && vNow > 1;
      const directive = useRelative ? formatInstructionRelativeTR(h, step) : formatInstructionTR(step);
      const { pre, final } = getTwoStageThresholds(step, vNow);

      if (!flags.pre && dist <= pre && dist > final + 8) {
        sayQueued(`Yaklaşık ${metersFmt(pre)} sonra ${directive}.`, { minGapMs: 1200 });
        const updated = { ...flags, pre: true };
        spokenRef.current = { ...spokenRef.current, [key]: updated };
        setSpokenFlags(spokenRef.current);
      }

      if (!flags.final && dist <= final && dist > Math.max(6, final - 12)) {
        buzz();
        sayQueued(`Şimdi ${shortDirectiveTR(h, step)}.`, { delayMs: 700, minGapMs: 1500 });
        const updated = { ...flags, final: true };
        spokenRef.current = { ...spokenRef.current, [key]: updated };
        setSpokenFlags(spokenRef.current);
      }

      const m = step.maneuver || {};
      const hEff = typeof sensorHdg === 'number' && sensorHdg >= 0 ? sensorHdg : headingRef.current;
      const bearingOK =
        typeof m.bearing_after === 'number' && typeof hEff === 'number'
          ? Math.abs(normalizeDeg180(m.bearing_after - hEff)) < 30
          : false;

      const speedOk = (Number.isFinite(v) ? v : 0) > 1.5;

      let passedByTrend = false;
      if (minDistRef.current != null && dist > minDistRef.current + 8 && minDistRef.current < 45) {
        trendCountRef.current += 1;
        passedByTrend = trendCountRef.current >= 2;
      } else {
        trendCountRef.current = 0;
      }

      let bearingPass = false;
      if (bearingOK && dist < 30 && speedOk) {
        bearingOkCountRef.current += 1;
        bearingPass = bearingOkCountRef.current >= 2;
      } else {
        bearingOkCountRef.current = 0;
      }

      const gatePass = (() => {
        if (typeof m.bearing_after === 'number' && t) {
          const gate = destinationPoint(t.lat, t.lng, m.bearing_after, 12);
          const dGate = getDistanceMeters(user, gate);
          return dGate + 4 < dist && dist < 45;
        }
        return false;
      })();

      const closeEnough = dist <= doneAt;

      if (!flags.done && (closeEnough || passedByTrend || bearingPass || gatePass)) {
        const updated = { ...flags, done: true };
        spokenRef.current = { ...spokenRef.current, [key]: updated };
        setSpokenFlags(spokenRef.current);

        if (idx >= curSteps.length - 1) {
          speak('Varış noktasına ulaştınız.');
          return;
        }

        const nextIndex = idx + 1;
        setCurrentStepIndex(nextIndex);
        stepIndexRef.current = nextIndex;

        minDistRef.current = null;
        trendCountRef.current = 0;
        bearingOkCountRef.current = 0;

        const next = curSteps[nextIndex];
        const h2 = headingRef.current;
        sayQueued(formatInstructionRelativeTR(h2, next), { delayMs: NEXT_STEP_DELAY_MS, minGapMs: 2000 });

        const loc2 = lastLocRef.current;
        const nxtTarget = getManeuverTarget(next);
        if (nxtTarget && loc2) {
          const user2 = { lat: loc2.latitude, lng: loc2.longitude };
          setDistanceToManeuver(getDistanceMeters(user2, nxtTarget));
        } else {
          setDistanceToManeuver(getStepDistanceValue(next) ?? null);
        }
      }
    } else {
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      if (Number.isFinite(dRoute)) {
        setDistanceToManeuver(dRoute);
        setLiveRemain({ dist: dRoute, sec: Math.round(dRoute / 12.5) });
      }
    }
  };

  const onGPSUpdate = (loc) => ingestLocation('gps', loc);

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

  const effSec = liveRemain.sec ?? pendingRouteMeta?.sec ?? remaining.sec;
  const effDist = liveRemain.dist ?? pendingRouteMeta?.dist ?? remaining.dist;
  const etaStr = formatETA(effSec);
  const remainDistStr = effDist != null ? metersFmt(effDist) : '—';
  const remainDurStr = formatDurationShort(effSec);
  const progressPct = useMemo(() => {
    if (!remaining.totalSec || !Number.isFinite(remaining.totalSec)) return 0;
    const done = remaining.totalSec - (remaining.sec || 0);
    return Math.max(0, Math.min(100, Math.round((done / remaining.totalSec) * 100)));
  }, [remaining.sec, remaining.totalSec]);

  // Reset + ilk mesafe
  useEffect(() => {
    setCurrentStepIndex(0);
    stepIndexRef.current = 0;
    setSpokenFlags({});
    spokenRef.current = {};
    setLiveRemain({ dist: null, sec: null });
    const s0 = stepsRef.current?.[0];
    const loc = lastLocRef.current;
    if (s0 && loc) {
      const target = getManeuverTarget(s0);
      const user = { lat: loc.latitude, lng: loc.longitude };
      if (target) {
        setDistanceToManeuver(getDistanceToMeters(user, target));
      } else {
        const dRoute = distanceToRoute(user, routeCoordsRef.current);
        setDistanceToManeuver(Number.isFinite(dRoute) ? dRoute : null);
      }
    } else if (loc) {
      const user = { lat: loc.latitude, lng: loc.longitude };
      const dRoute = distanceToRoute(user, routeCoordsRef.current);
      setDistanceToManeuver(Number.isFinite(dRoute) ? dRoute : null);
    } else setDistanceToManeuver(null);
    setCamZoom(DEFAULT_ZOOM);
    setCamPitch(DEFAULT_PITCH);
    if (steps && steps.length) setPendingRouteMeta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, from, to, polyline]);

  useEffect(() => {
    if (!navStarted && steps && steps.length > 0) {
      setNavStarted(true);
      speak('Navigasyon başlatıldı.');
    }
  }, [steps, navStarted, speak]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spokenFlags, setSpokenFlags] = useState({});
  const spokenRef = useRef({});
  useEffect(() => { spokenRef.current = spokenFlags; }, [spokenFlags]);

  const [candidateStop, setCandidateStop] = useState(null);
  const [addStopOpen, setAddStopOpen] = useState(false);

  const markerRefs = useRef(new Map());
  const setMarkerRef = useCallback((id, ref) => {
    if (ref) markerRefs.current.set(id, ref);
    else markerRefs.current.delete(id);
  }, []);
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

  // ——— Durak düzenleme (EditStopsOverlay) ———
  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]);
  const [insertIndex, setInsertIndex] = useState(null);
  const insertIndexRef = useRef(null);
  useEffect(() => { insertIndexRef.current = insertIndex; }, [insertIndex]);
  const pendingInsertRef = useRef(null);

  const handleDeleteStop = useCallback((index) => {
    setDraftStops(prev => prev.filter((_, i) => i !== index));
  }, []);
  const handleReorderStops = useCallback((fromIndex, toIndex) => {
    setDraftStops(prev => arrayMove(prev, fromIndex, toIndex));
  }, []);
  const handleAddAt = useCallback((index) => {
    setInsertIndex(index);
    setAddStopOpen(true);
  }, []);
  const cancelEditStops = useCallback(() => {
    setEditStopsOpen(false);
    setDraftStops([]);
    setInsertIndex(null);
  }, []);

  const confirmEditStops = useCallback(() => {
    setWaypoints(draftStops);
    setEditStopsOpen(false);
    setInsertIndex(null);
    recalcRoute({ keepSpeak: false, waypointsOverride: draftStops });
  }, [draftStops, recalcRoute]);

  const pendingOpRefLocal = pendingOpRef; // alias for readability

  const insertOrAppendStop = useCallback(({ lat, lng, name, place_id, address }) => {
    const payload = { lat, lng, place_id, name, address };
    focusOn(lng, lat, 18);

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
  }, [insertIndex, focusOn, recalcRoute, clearPoi]);

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
    } catch {}
  }, [insertOrAppendStop]);

  const handleAddStopFromPOI = useCallback(async (place) => {
    let lat, lng, name, place_id, address;

    if (place?.geometry?.location) {
      lat = place.geometry.location.lat;
      lng = place.geometry.location.lng;
      name = place.name || 'Seçilen yer';
      address = place.vicinity || place.formatted_address || '';
      place_id = place.place_id || place.id;
    } else if (candidateStop) {
      ({ lat, lng, name, place_id, address } = candidateStop);
    } else if (place?.place_id || place?.id) {
      const d = await getPlaceDetails(place.place_id || place.id);
      lat = d?.geometry?.location?.lat;
      lng = d?.geometry?.location?.lng;
      name = d?.name || 'Seçilen yer';
      address = d?.formatted_address || d?.vicinity || '';
      place_id = d?.place_id || place?.id;
    } else {
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    insertOrAppendStop({ lat, lng, name, place_id, address });
  }, [candidateStop, insertOrAppendStop]);

  // Alternatif rota (kalan kısım orijinal)
  const parseRoutes = useCallback((routesRaw) => {
    const list = Array.isArray(routesRaw)
      ? routesRaw
      : routesRaw?.routes || routesRaw?.alternatives || (routesRaw ? [routesRaw] : []);

    return list
      .map((r, i) => {
        let coords = [];
        if (r.geometry && r.geometry.type === 'LineString' && Array.isArray(r.geometry.coordinates)) {
          coords = r.geometry.coordinates;
        } else {
          const poly =
            r.polyline ||
            (typeof r.overview_polyline === 'string'
              ? r.overview_polyline
              : r.overview_polyline?.points) ||
            r.routePolyline ||
            null;
          if (poly) {
            const dec = decodePolyline(poly);
            coords = dec.map((c) => [c.longitude, c.latitude]);
          }
        }

        let dist = null, dur = null;
        if (typeof r.distance === 'number') dist = r.distance;
        else if (typeof r.distance?.value === 'number') dist = r.distance.value;
        else if (Array.isArray(r.legs)) dist = r.legs.reduce((s, l) => s + (l?.distance?.value || 0), 0);

        if (typeof r.duration === 'number') dur = r.duration;
        else if (typeof r.duration?.value === 'number') dur = r.duration.value;
        else if (Array.isArray(r.legs)) dur = r.legs.reduce((s, l) => s + (l?.duration?.value || 0), 0);

        return {
          id: r.id || String(i),
          coords,
          distance: dist,
          duration: dur,
          polyline:
            r.polyline || r.overview_polyline?.points || r.overview_polyline || r.routePolyline || null,
          summary: r.summary || r.name || `Rota ${i + 1}`,
          steps: r.steps || (r.legs ? r.legs.flatMap((x) => x.steps || []) : []),
        };
      })
      .filter((x) => x.coords.length >= 2);
  }, []);

  const loadAlternatives = useCallback(async () => {
    setAltFetching(true);
    try {
      const origin = lastLocRef.current
        ? { latitude: lastLocRef.current.latitude, longitude: lastLocRef.current.longitude }
        : { latitude: from.latitude, longitude: from.longitude };
      const opts = { alternatives: true };
      if (waypointsRef.current?.length) {
        opts.waypoints = waypointsRef.current.map(w => ({ lat: w.lat, lng: w.lng, via: true }));
        opts.optimize = false;
      }
      const raw = await getRoute(toLL(origin), toLL(to), 'driving', opts);
      let parsed = parseRoutes(raw);
      const curLen = routeCoordsRef.current?.length || 0;
      parsed = parsed.filter((r) => Math.abs(r.coords.length - curLen) > 2);
      setAltRoutes(parsed);
    } catch {
      setAltRoutes([]);
    } finally {
      setAltFetching(false);
    }
  }, [from, to, parseRoutes]);

  const toggleAlternatives = useCallback(() => {
    if (isAddingStop) return;
    setAltMode((prev) => {
      const next = !prev;
      if (next) loadAlternatives();
      else setAltRoutes([]);
      return next;
    });
  }, [loadAlternatives, isAddingStop]);

  const applyAlternative = useCallback(
    async (r) => {
      const meta = { sec: r.duration ?? null, dist: r.distance ?? null };
      const rpId = beginRouteUpdate(r.coords, meta);

      if (Array.isArray(r.steps) && r.steps.length) {
        finalizeRouteSteps(rpId, r.steps);
      } else {
        const origin = lastLocRef.current
          ? { lat: lastLocRef.current.latitude, lng: lastLocRef.current.longitude }
          : toLL(from);
        try {
          const mSteps = await getTurnByTurnSteps(origin, toLL(to));
          finalizeRouteSteps(rpId, mSteps);
        } catch {
          finalizeRouteSteps(rpId, []);
        }
      }

      const baseS = effSec ?? null;
      const cmp = formatAltComparison(baseS, r.duration ?? NaN);
      if (cmp?.text) safeSpeak(`Alternatif rota seçildi, ${cmp.text}.`);
    },
    [beginRouteUpdate, finalizeRouteSteps, from, to, effSec, safeSpeak]
  );

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
        const c = e?.nativeEvent?.coordinate;
        if (c) onGPSUpdate({
          coords: {
            latitude: c.latitude,
            longitude: c.longitude,
            heading: c.heading,
            speed: c.speed,
            accuracy: c.accuracy,
          },
        });
      }}
      onPress={() => {
        setIsMapTouched(true);
        if (!followBackSuppressedRef.current) scheduleFollowBack();
      }}
      onPanDrag={() => {
        setIsMapTouched(true);
        setIsFollowing(false);
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
      onPress={() =>
        speak(
          steps?.[currentStepIndex]
            ? formatInstructionRelativeTR(heading, steps[currentStepIndex])
            : 'Navigasyon'
        )
      }
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
             if (simTimerRef.current) clearInterval(simTimerRef.current);
             setSimActive(false);
             setSimCoord(null);
              navigation.goBack(); // ✅ Map’teki rota state’i korunur
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
      onAddStop={handleAddStopFromPOI}
      routeBounds={
        poiActive?.type
          ? (() => {
              const coords = routeCoordinates;
              if (!coords || coords.length < 2) return null;
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
              const pad = 0.02;
              return {
                sw: { lat: minLat - pad, lng: minLng - pad },
                ne: { lat: maxLat + pad, lng: maxLng + pad },
              };
            })()
          : null
      }
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
};

/* --------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff', // siyah ekranı maskeleyen güvenli zemin
  },
  map: {
    ...StyleSheet.absoluteFillObject, // flex:1 yerine
  },

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
