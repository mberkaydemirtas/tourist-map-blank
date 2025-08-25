// src/MapScreen.js
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Callout } from 'react-native-maps';
import MarkerCallout from './components/MarkerCallout';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MapMarkers from './components/MapMarkers';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import PlaceDetailSheet from './components/PlaceDetailSheet';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';
import RouteInfoSheet from './components/RouteInfoSheet';
import NavigationBanner from './components/NavigationBanner';
import MapRoutePolyline from './components/MapRoutePolyline';
import AddStopOverlay from './components/AddStopOverlay';
import EditStopsOverlay from './components/EditStopsOverlay2';

import { normalizeCoord, toCoordsObject } from './utils/coords';

// maps helpers
import {
  getRoute,
  decodePolyline,
  reverseGeocode,
  getPlaceDetails,
  getNearbyPlaces,
  autocomplete,
} from './maps';

/* ------------------------- küçük yardımcılar ------------------------- */
const placeForHistory = ({ lat, lng, name, address, place_id, description }) => {
  const n   = name ?? description ?? 'Seçilen yer';
  const adr = address ?? description ?? '';
  const pid = place_id ?? null;
  return {
    place_id: pid,
    name: n,
    address: adr,
    lat, lng,
    ts: Date.now(),
    description: n || adr,
    structured_formatting: { main_text: n, secondary_text: adr },
    geometry: { location: { lat, lng } },
    coords: { latitude: lat, longitude: lng },
  };
};

const upsertHistoryObject = async (key, item, maxLen = 30) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    const keyOf = (x) => x.place_id || `${Math.round(x.lat * 1e6)},${Math.round(x.lng * 1e6)}`;
    const idNew = keyOf(item);
    const filtered = Array.isArray(arr) ? arr.filter(x => keyOf(x) !== idNew) : [];
    const next = [item, ...filtered].slice(0, maxLen);
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch {}
};

const pushLabelHistory = async (key, label, maxLen = 20) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    let arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
    const next = [label, ...arr.filter(x => x !== label)].slice(0, maxLen);
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch {}
};

const saveHistoryObjects = async (keys, payload) => {
  const item = placeForHistory(payload);
  await Promise.all(keys.map(k => upsertHistoryObject(k, item).catch(() => {})));
};

const toLL = (p) => ({ lat: p.lat ?? p.latitude, lng: p.lng ?? p.longitude });
const meters = (a, b) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371e3;
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lng - a.lng);
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};
const poiIdOf = (p) => p?.place_id || p?.id || `${p?.geometry?.location?.lng}_${p?.geometry?.location?.lat}`;
const clamp = (min, max, v) => Math.min(max, Math.max(min, v));

/* NEW: kesin lat/lng, eşitlik ve dedup yardımcıları */
const toStrictLL = (c) => {
  const lat = c?.lat ?? c?.latitude;
  const lng = c?.lng ?? c?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};
const nearlySame = (a, b, m = 5) => {
  if (!a || !b) return false;
  try { return meters(a, b) <= m; } catch { return false; }
};
const dedupWaypoints = (wps, fromLL, toLL_) => {
  const out = [];
  for (const w of wps) {
    const llOnly = toStrictLL(w);
    if (!llOnly) continue;
    const ll = { ...llOnly, place_id: w.place_id ?? w.id ?? null };
    if (fromLL && nearlySame(ll, fromLL)) continue;
    if (toLL_ && nearlySame(ll, toLL_)) continue;
    if (out.some(prev => nearlySame(prev, ll))) continue;
    out.push(ll);
  }
  return out;
};

/* ------------ WAYPOINT KAPSAMA KONTROLÜ + SEGMENT FALLBACK ------------ */
const approxRouteCoversWaypoints = (decodedCoords, wpsLL, tolMeters = 120) => {
  if (!Array.isArray(decodedCoords) || decodedCoords.length === 0) return false;

  const pts = decodedCoords
    .map(p => {
      const lat = p.latitude ?? p.lat;
      const lng = p.longitude ?? p.lng;
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    })
    .filter(Boolean);

  const nearestIdx = (w) => {
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      try {
        const d = meters(pts[i], w);
        if (d < bestD) { bestD = d; bestI = i; }
      } catch {}
    }
    return { i: bestI, d: bestD };
  };

  const hits = wpsLL.map(nearestIdx);
  const covers = hits.every(h => Number.isFinite(h.d) && h.d <= tolMeters);
  if (!covers) return false;
  for (let k = 1; k < hits.length; k++) {
    if (!(hits[k - 1].i < hits[k].i)) return false;
  }
  return true;
};

const stitchSegments = (segments) => {
  const all = [];
  for (let i = 0; i < segments.length; i++) {
    const part = segments[i];
    if (!Array.isArray(part) || part.length === 0) continue;
    if (i > 0 && all.length) {
      const first = part[0], last = all[all.length - 1];
      if (
        Math.abs((first.latitude ?? first.lat) - (last.latitude ?? last.lat)) < 1e-6 &&
        Math.abs((first.longitude ?? first.lng) - (last.longitude ?? last.lng)) < 1e-6
      ) {
        part.shift();
      }
    }
    all.push(...part);
  }
  return all;
};

/* --- Request key helpers --- */
const recHashNum = (v) => (Number.isFinite(v) ? v.toFixed(6) : 'x');
const recHashPoint = (p) =>
  p ? `${recHashNum(p.lat ?? p.latitude)},${recHashNum(p.lng ?? p.longitude)}` : 'x,x';
const makeRequestKey = (mode, fromLL, toLL_, wpsArr) => {
  const wpsSig = (Array.isArray(wpsArr) ? wpsArr : [])
    .map(w => `${recHashPoint(w)}#${w.place_id || ''}`)
    .join('|');
  return `m:${mode}|f:${recHashPoint(fromLL)}|t:${recHashPoint(toLL_)}|w:${wpsSig}`;
};

export default function MapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const picker = route.params?.picker?.enabled ? route.params.picker : null; // { enabled, which: 'start'|'end'|'lodging', cityKey, sheetInitial? }
  const mapRef = useRef(null);
  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();
  const routeCalcSeqRef = useRef(0);
  const routeActiveKeyRef = useRef(null);

  // sheets
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);

  const presentRouteSheet = useCallback(() => {
    const r = sheetRefRoute.current;
    if (!r) return;
    r.present?.();
    r.expand?.();
    r.snapToIndex?.(0);
  }, []);
  const dismissRouteSheet = useCallback(() => {
    const r = sheetRefRoute.current;
    if (!r) return;
    r.dismiss?.();
    r.close?.();
  }, []);

  // UI
  const [mode, setMode] = useState('explore'); // 'explore' | 'route'
  const [canShowScan, setCanShowScan] = useState(false);
  const [mapMovedAfterDelay, setMapMovedAfterDelay] = useState(false);
  const [showFromOverlay, setShowFromOverlay] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayContext, setOverlayContext] = useState(null); // 'from' | 'to'
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);

  // route
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  // (optional) nav banner
  const [isNavigating, setIsNavigating] = useState(false);
  const [firstManeuver, setFirstManeuver] = useState(null);

  // multi-stop
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]); // [from, ...wps, to]
  const [pendingEditOp, setPendingEditOp] = useState(null); // { type: 'insert'|'replace', index: number }

  // POI along route
  const [candidateStop, setCandidateStop] = useState(null);
  const [poiMarkers, setPoiMarkers] = useState([]);
  const markerRefs = useRef(new Map());
  const setMarkerRef = useCallback((id, ref) => {
    if (ref) markerRefs.current.set(id, ref);
    else markerRefs.current.delete(id);
  }, []);
  const stablePoiList = useMemo(() => {
    const arr = Array.isArray(poiMarkers) ? poiMarkers : [];
    return arr.map(p => ({ ...p, __id: poiIdOf(p) })).sort((a, b) => (a.__id > b.__id ? 1 : -1));
  }, [poiMarkers]);

  const routeBounds = useMemo(() => {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const c of routeCoords) {
      const lat = c.latitude ?? c.lat;
      const lng = c.longitude ?? c.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const pad = 0.02;
    return { sw: { lat: minLat - pad, lng: minLng - pad }, ne: { lat: maxLat + pad, lng: maxLng + pad } };
  }, [routeCoords]);

  /* -------------------------- MIGRASYON -------------------------- */
  // Picker 'lodging' ise sheet'i yarım açmayı dene
  useEffect(() => {
    if (picker?.which === 'lodging') {
      try { sheetRef.current?.snapToIndex?.(1); } catch (e) {}
    }
  }, [picker]);

   // Wizard'dan picker.center geldiyse o şehrin merkezine zoomla
  useEffect(() => {
    const c = picker?.center ? normalizeCoord(picker.center) : null;
    if (c && mapRef.current) {
      const region = { ...c, latitudeDelta: 0.08, longitudeDelta: 0.08 };
      map.setRegion(region);
      mapRef.current.animateToRegion(region, 500);
    }
  }, [picker?.center]);

  useEffect(() => {
    const HISTORY_KEYS_OBJECT = [
      'route_stop_history',
      'favorite_places',
      'favorite_places_from',
      'favorite_places_to',
      'route_stop_favorites',
    ];
    const HISTORY_KEYS_LABEL = [
      'search_history',
      'search_history_from',
      'search_history_to',
    ];

    const migrateHistory = async () => {
      try {
        for (const k of HISTORY_KEYS_LABEL) {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) continue;
          let arr = JSON.parse(raw);
          if (!Array.isArray(arr)) continue;
          const containsObject = arr.some(x => x && typeof x === 'object');
          if (containsObject) {
            const next = arr
              .map(x => {
                if (typeof x === 'string') return x;
                if (!x || typeof x !== 'object') return null;
                return x.description || x.name || x.address || '';
              })
              .filter(Boolean);
            await AsyncStorage.setItem(k, JSON.stringify(next));
          }
        }
        for (const k of HISTORY_KEYS_OBJECT) {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) continue;
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) continue;
        }
      } catch (e) {
        console.warn('history migration error', e);
      }
    };

    migrateHistory();
  }, []);

  /* -------------------------- KAMERA / UI -------------------------- */
  useEffect(() => {
    if (map.categoryMarkers.length > 0) {
      const cs = map.categoryMarkers
        .map(item => normalizeCoord(item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item))
        .filter(Boolean);
      let t;
      if (cs.length > 0) {
        t = setTimeout(() => {
          mapRef.current?.fitToCoordinates(cs, {
            edgePadding: { top: 100, bottom: 300, left: 100, right: 100 },
            animated: true,
          });
        }, 500);
      }
      return () => t && clearTimeout(t);
    }
  }, [map.categoryMarkers]);

  useEffect(() => {
    if (mode === 'explore' && !map.fromLocation && map.marker) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [map.marker, mode, map.fromLocation]);

  const lastAvailable = useRef(false);
  useEffect(() => {
    if (!lastAvailable.current && available && coords && mapRef.current) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      requestAnimationFrame(() => {
        map.setRegion(region);
        mapRef.current.animateToRegion(region, 500);
      });
    }
    lastAvailable.current = available;
  }, [available, coords]);

  useEffect(() => {
    setCanShowScan(false);
    setMapMovedAfterDelay(false);
    if (map.activeCategory) {
      const timer = setTimeout(() => setCanShowScan(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [map.activeCategory]);

  const onRegionChangeComplete = region => {
    map.setRegion(region);
    if (canShowScan) setMapMovedAfterDelay(true);
  };

  /* --------------------------- ROTA --------------------------- */

  const buildSegmentedRoute = useCallback(
    async (fromLL, toLL_, cleanLL, selMode) => {
      try {
        const nodes = [fromLL, ...cleanLL, toLL_];
        const segments = [];
        let totalDist = 0;
        let totalDur = 0;

        for (let i = 0; i < nodes.length - 1; i++) {
          const a = nodes[i], b = nodes[i + 1];
          const raw = await getRoute(a, b, selMode, { optimize: false, alternatives: false, __seg: i });
          const seg = Array.isArray(raw) ? raw[0] : raw;
          const dec = seg?.decodedCoords || decodePolyline(seg?.polyline || '');
          if (!dec || !dec.length) {
            console.warn('[route:fallback] segment failed (no polyline)', i);
            return null;
          }
          segments.push(dec);
          totalDist += seg?.distance || 0;
          totalDur  += seg?.duration || 0;
        }

        const mergedCoords = stitchSegments(segments);
        const merged = {
          id: `${selMode}-segmented`,
          isPrimary: true,
          decodedCoords: mergedCoords,
          distance: totalDist,
          duration: totalDur,
          mode: selMode,
        };
        return merged;
      } catch (e) {
        console.warn('[route:fallback] error', e?.message || e);
        return null;
      }
    },
    []
  );

  const recalcRoute = useCallback(
    async (
      selMode = map.selectedMode,
      waypointsOverride = null,
      fromOverride = null,
      toOverride = null
    ) => {
      const mySeq = ++routeCalcSeqRef.current;

      const fromC0 = normalizeCoord(fromOverride ?? map.fromLocation?.coords);
      const toC0   = normalizeCoord(toOverride  ?? map.toLocation?.coords);
      const fromLL = toStrictLL(fromC0);
      const toLL_  = toStrictLL(toC0);
      if (!fromLL || !toLL_) return;

      const srcWps = Array.isArray(waypointsOverride) ? waypointsOverride : map.waypoints;

      const wpIdsRaw = (Array.isArray(srcWps) ? srcWps : [])
        .map(w => w?.place_id || w?.id)
        .filter(Boolean);

      const wpsLL_raw  = (Array.isArray(srcWps) ? srcWps : [])
        .map(w => ({
          lat: w?.lat ?? w?.latitude ?? w?.coords?.latitude ?? w?.location?.lat,
          lng: w?.lng ?? w?.longitude ?? w?.coords?.longitude ?? w?.location?.lng,
          place_id: w?.place_id || w?.id || null
        }))
        .filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lng));

      const cleanLL = dedupWaypoints(wpsLL_raw, fromLL, toLL_);

      const reqKey = makeRequestKey(selMode, fromLL, toLL_, [
        ...cleanLL.map(w => ({ latitude: w.lat, longitude: w.lng, place_id: w.place_id })),
        ...wpIdsRaw
          .filter(pid => !cleanLL.some(w => w.place_id === pid))
          .map(pid => ({ latitude: NaN, longitude: NaN, place_id: pid }))
      ]);
      routeActiveKeyRef.current = reqKey;

      const wpPlaceId      = Array.from(new Set(wpIdsRaw)).map(pid => `via:place_id:${pid}`);
      const wpViaLatLng    = cleanLL.map(w => `via:${w.lat.toFixed(6)},${w.lng.toFixed(6)}`);
      const wpLLForSegment = cleanLL.map(w => ({ lat: w.lat, lng: w.lng }));
      const baseOpts = { optimize: false, alternatives: cleanLL.length === 0 };

      const attempts = [
        wpPlaceId.length      ? { ...baseOpts, waypoints: wpPlaceId,   __attempt: 'via:place_id' } : null,
        wpViaLatLng.length    ? { ...baseOpts, waypoints: wpViaLatLng, __attempt: 'via:latlng' }   : null,
        wpLLForSegment.length ? { ...baseOpts, waypointsLL: wpLLForSegment, __attempt: 'LL-array' } : null,
      ].filter(Boolean);

      let routes = null;
      let lastErr = null;

      const normalizeList = (raw, attemptTag) => {
        const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((r, i) => ({
          ...r,
          decodedCoords: r.decodedCoords || decodePolyline(r.polyline || ''),
          isPrimary: i === 0,
          id: `${selMode}-${attemptTag}-${i}`,
          mode: selMode,
        }));
        return list;
      };

      for (const opts of attempts) {
        try {
          const raw   = await getRoute(fromLL, toLL_, selMode, { ...opts, __debug: true });
          let list    = normalizeList(raw, opts.__attempt);
          const ok    = list.length && list[0].decodedCoords?.length > 0;

          if (!ok) continue;

          const hasCheckable = cleanLL.length > 0;
          if (hasCheckable) {
            const covers = approxRouteCoversWaypoints(list[0].decodedCoords, cleanLL);
            if (!covers) {
              if (opts.__attempt !== 'via:latlng' && wpViaLatLng.length) {
                try {
                  const raw2  = await getRoute(fromLL, toLL_, selMode, { ...baseOpts, waypoints: wpViaLatLng, __attempt: 'via:latlng:forced' });
                  const list2 = normalizeList(raw2, 'via:latlng:forced');
                  const ok2   = list2.length && list2[0].decodedCoords?.length > 0;
                  const cov2  = ok2 && approxRouteCoversWaypoints(list2[0].decodedCoords, cleanLL);
                  if (ok2 && cov2) {
                    list = list2;
                  } else {
                    const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                    if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                    else { continue; }
                  }
                } catch {
                  const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                  if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                  else { continue; }
                }
              } else {
                const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                else { continue; }
              }
            }
          }

          routes = list;
          break;
        } catch (e) {
          lastErr = e;
          console.warn('getRoute attempt failed', opts.__attempt, e?.message || e);
        }
      }

      if (!routes && cleanLL.length) {
        const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
        if (merged) { merged.isPrimary = true; routes = [merged]; }
      }

      const stale = mySeq !== routeCalcSeqRef.current || reqKey !== routeActiveKeyRef.current;
      if (!routes) {
        if (stale) return;
        const hadPrev = Array.isArray(map.routeOptions?.[selMode]) && map.routeOptions[selMode].length > 0;
        if (hadPrev) return;
        setRouteCoords([]);
        setRouteInfo(null);
        map.setRouteOptions(prev => ({ ...prev, [selMode]: [] }));
        return;
      }

      if (stale) return;

      map.setRouteOptions(prev => ({ ...prev, [selMode]: routes }));
      const primary = routes.find(r => r.isPrimary) || routes[0];
      setRouteCoords(primary.decodedCoords || []);
      setRouteInfo({ distance: primary.distance, duration: primary.duration });

      if (primary?.decodedCoords?.length) {
        mapRef.current?.fitToCoordinates(primary.decodedCoords, {
          edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
          animated: true,
        });
        requestAnimationFrame(presentRouteSheet);
      }
    },
    [map.fromLocation, map.toLocation, map.waypoints, map.selectedMode, buildSegmentedRoute, presentRouteSheet, map, mapRef]
  );

  useEffect(() => {
    if (mode !== 'route') return;
    const list = map.routeOptions?.[map.selectedMode];
    if (!Array.isArray(list) || list.length === 0) return;

    const primary = list.find(r => r.isPrimary) ?? list[0];
    if (primary?.decodedCoords?.length) {
      setRouteCoords(primary.decodedCoords);
      setRouteInfo({ distance: primary.distance, duration: primary.duration });
      mapRef.current?.fitToCoordinates(primary.decodedCoords, {
        edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
        animated: true,
      });
      requestAnimationFrame(presentRouteSheet);
    }
  }, [mode, map.selectedMode, map.routeOptions, presentRouteSheet]);

  useEffect(() => {
    const ready = mode === 'route' && Array.isArray(routeCoords) && routeCoords.length > 0;
    if (ready) {
      const id = setTimeout(() => presentRouteSheet(), 0);
      return () => clearTimeout(id);
    } else {
      dismissRouteSheet();
    }
  }, [mode, routeCoords, presentRouteSheet, dismissRouteSheet]);

  // RoutePlannerCard -> Map geçişini karşıla
  useEffect(() => {
    const req = route?.params?.routeRequest;
    if (!req || !req.from || !req.to) return;

    const fromC = normalizeCoord(req.from);
    const toC   = normalizeCoord(req.to);
    if (!fromC || !toC) return;

    setMode('route');
    map.setFromLocation({
      coords: fromC,
      description: req.from.name || 'Başlangıç',
      key: req.from.place_id || 'external',
    });
    map.setToLocation({
      coords: toC,
      description: req.to.name || 'Bitiş',
      key: req.to.place_id || 'external',
    });

    const wps = Array.isArray(req.waypoints)
      ? req.waypoints
          .map(w => {
            const lat =
              w.lat ?? w.latitude ??
              w?.coords?.latitude ?? w?.location?.lat;
            const lng =
              w.lng ?? w.longitude ??
              w?.coords?.longitude ?? w?.location?.lng;
            return {
              lat,
              lng,
              name: w.name,
              address: w.address,
              place_id: w.place_id || w.id || null,
            };
          })
          .filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lng))
      : [];

    map.setWaypoints(wps);
    if (req.mode) map.setSelectedMode(req.mode);

    const toFit = [
      { latitude: fromC.latitude, longitude: fromC.longitude },
      ...wps.map(w => ({ latitude: w.lat, longitude: w.lng })),
      { latitude: toC.latitude,   longitude: toC.longitude },
    ];
    requestAnimationFrame(() => {
      if (mapRef.current && toFit.length >= 2) {
        mapRef.current.fitToCoordinates(toFit, {
          edgePadding: { top: 60, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }
    });

    setTimeout(() => {
      recalcRoute(req.mode, wps, fromC, toC);
    }, 0);

    navigation.setParams({ routeRequest: undefined });
  }, [route?.params?.routeRequest, navigation, recalcRoute, map.setFromLocation, map.setToLocation, map.setWaypoints, map.setSelectedMode]);

  /* --------------------- FROM/TO seçim --------------------- */
  const setToFromMarkerIfMissing = useCallback(() => {
    if (map.toLocation) return;
    const c = normalizeCoord(
      map.marker?.coords ?? map.marker?.coordinate ?? map.marker?.geometry?.location ?? map.marker
    );
    if (!c) return;
    const desc =
      map.marker?.name ||
      map.marker?.formatted_address ||
      map.marker?.address ||
      'Seçilen Konum';

    map.setToLocation({ coords: c, description: desc, key: map.marker?.place_id || 'map' });
  }, [map.toLocation, map.marker, map]);

  const handleReverseRoute = async () => {
    if (!map.fromLocation?.coords || !map.toLocation?.coords) return;
    const newFrom = map.toLocation;
    const newTo   = map.fromLocation;
    map.setFromLocation(newFrom);
    map.setToLocation(newTo);
    await recalcRoute(map.selectedMode);
  };

  const onGetDirectionsPress = () => {
    if (!map.toLocation && (map.marker?.coords || map.marker?.coordinate)) {
      const c = normalizeCoord(map.marker?.coords ?? map.marker?.coordinate);
      map.setToLocation({
        coords: c,
        description: map.marker.name || 'Seçilen Yer',
        key: map.marker.place_id || 'map',
      });
    }
    sheetRef.current?.close();
    setShowFromOverlay(true);
  };

  const handleFromSelected = async (src) => {
    setShowFromOverlay(false);
    if (src.key === 'map') {
      setIsSelectingFromOnMap(true);
      setOverlayContext('from');
      setShowSelectionHint(true);
      return;
    }

    let address = src.description || 'Seçilen Konum';
    const placeId = src.key === 'map' || src.key === 'current' ? null : src.key;

    const srcCoord = normalizeCoord(src?.coords ?? src);
    if ((src.key === 'map' || src.key === 'current') && srcCoord) {
      try {
        const geo = await reverseGeocode(srcCoord);
        if (geo?.[0]) address = geo[0].formatted_address || address;
      } catch {}
    }

    const normFrom = toCoordsObject(src) ?? { ...src, coords: srcCoord };
    const fromSrc = { ...normFrom, description: address, key: src.key };

    map.setFromLocation(fromSrc);

    await pushLabelHistory('search_history', fromSrc.description);
    await pushLabelHistory('search_history_from', fromSrc.description);

    setMode('route');
    setToFromMarkerIfMissing();

    try {
      if (placeId) {
        await map.fetchAndSetMarker(placeId, fromSrc.coords, address);
      } else if (fromSrc.coords) {
        map.setMarker({ coords: fromSrc.coords, name: address, address });
      }
    } catch {}

    await recalcRoute();
  };

  const handleToSelected = useCallback(
    async (place) => {
      try {
        const pid = place?.place_id || place?.id;
        let lat =
          place?.geometry?.location?.lat ??
          place?.location?.lat ??
          place?.coords?.latitude ??
          place?.lat;
        let lng =
          place?.geometry?.location?.lng ??
          place?.location?.lng ??
          place?.coords?.longitude ??
          place?.lng;
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

        const coord = { latitude: lat, longitude: lng };
        const label = name || address || 'Seçilen Konum';

        map.setToLocation({ coords: coord, description: label, key: pid || 'map' });

        await pushLabelHistory('search_history', label);
        await pushLabelHistory('search_history_to', label);

        if (pid) {
          await map.fetchAndSetMarker(pid, coord, label);
        } else {
          map.setMarker({ coords: coord, name: label, address });
        }
        mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);

        setMode('route');
        await recalcRoute();
      } catch (e) {
        console.warn('handleToSelected error:', e);
      }
    },
    [recalcRoute, map, mapRef]
  );

  const confirmEditStops = useCallback(() => {
    if (!draftStops || draftStops.length < 2) return;
    const newWps = draftStops.slice(1, -1);
    map.setWaypoints(newWps);
    setEditStopsOpen(false);
    recalcRoute(map.selectedMode, newWps);
  }, [draftStops, recalcRoute, map.selectedMode, map]);

  // haritadan tek dokunuşla from/to seçimi
  const handleSelectOriginOnMap = async (coordinate) => {
    try {
      const geo = await reverseGeocode(coordinate);
      const address = geo?.[0]?.formatted_address || 'Seçilen Konum';
      const placeId = geo?.[0]?.place_id;
      let name = address;
      if (placeId) {
        try {
          const details = await getPlaceDetails(placeId);
          name = details?.name || address;
        } catch {}
      }
      const fromSrc = { coords: coordinate, description: name, key: placeId || 'map' };
      map.setFromLocation(fromSrc);
      await pushLabelHistory('search_history', name);
      await pushLabelHistory('search_history_from', name);
      setMode('route');
      setIsSelectingFromOnMap(false);
      await recalcRoute();
    } catch (e) {
      console.warn('select origin on map error:', e);
    }
  };

  const handleSelectDestinationOnMap = async (coordinate) => {
    try {
      const geo = await reverseGeocode(coordinate);
      const address = geo?.[0]?.formatted_address || 'Seçilen Konum';
      const placeId = geo?.[0]?.place_id;
      let name = address;
      if (placeId) {
        try {
          const details = await getPlaceDetails(placeId);
          name = details?.name || address;
        } catch {}
      }
      const label = name;
      map.setToLocation({ coords: normalizeCoord(coordinate), description: label, key: placeId || 'map' });
      await pushLabelHistory('search_history', label);
      await pushLabelHistory('search_history_to', label);
      setIsSelectingFromOnMap(false);
      await recalcRoute();
    } catch (e) {
      console.warn('select destination on map error:', e);
    }
  };

  const handleMapPress = (e) => {
    const { coordinate } = e.nativeEvent;
    if (mode === 'route' && isSelectingFromOnMap) {
      if (overlayContext === 'from') handleSelectOriginOnMap(coordinate);
      else if (overlayContext === 'to') handleSelectDestinationOnMap(coordinate);
      return;
    }
    map.handleMapPress(e);
  };

  const handleCancelRoute = () => {
    setMode('explore');
    map.setMarker(null);
    map.setFromLocation(null);
    map.setToLocation(null);
    map.setRouteOptions({});
    map.setWaypoints([]);
    setCandidateStop(null);
    setPoiMarkers([]);
    setRouteCoords([]);
    setRouteInfo(null);
    dismissRouteSheet();
  };

  /* ------------------------- ROTA KORİDORU POI ------------------------- */
  const distanceToRoute = useCallback((user, coordsLL) => {
    if (!coordsLL || coordsLL.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < coordsLL.length - 1; i++) {
      const A = { lat: coordsLL[i].latitude ?? coordsLL[i].lat, lng: coordsLL[i].longitude ?? coordsLL[i].lng };
      const B = { lat: coordsLL[i + 1].latitude ?? coordsLL[i + 1].lat, lng: coordsLL[i + 1].longitude ?? coordsLL[i + 1].lng };
      const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
      const d = meters(user, mid);
      if (d < best) best = d;
      if (best < 5) break;
    }
    return best;
  }, []);

  const fetchPlacesAlongRoute = useCallback(
    async ({ type = null, text = null, noCorridor = false } = {}) => {
      const coordsLL = routeCoords;
      if (!coordsLL || coordsLL.length < 2) {
        setPoiMarkers([]);
        return;
      }
      const SAMPLE_EVERY_M = 900;
      const NEARBY_RADIUS_M = 650;

      const samples = [];
      let acc = 0;
      for (let i = 0; i < coordsLL.length - 1; i++) {
        const A = { lat: coordsLL[i].latitude ?? coordsLL[i].lat, lng: coordsLL[i].longitude ?? coordsLL[i].lng };
        const B = { lat: coordsLL[i + 1].latitude ?? coordsLL[i + 1].lat, lng: coordsLL[i + 1].longitude ?? coordsLL[i + 1].lng };
        const seg = meters(A, B);
        if (acc === 0) samples.push(A);
        acc += seg;
        while (acc >= SAMPLE_EVERY_M) {
          acc -= SAMPLE_EVERY_M;
          const t = (seg - acc) / seg;
          samples.push({ lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t });
        }
      }
      const last = coordsLL[coordsLL.length - 1];
      samples.push({ lat: last.latitude ?? last.lat, lng: last.longitude ?? last.lng });

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
                const d = distanceToRoute({ lat, lng }, coordsLL);
                const slack = Math.max(NEARBY_RADIUS_M + 500, 1200);
                if (!Number.isFinite(d) || d > slack) continue;
              }
              seen.set(id, it);
            }
          }
        } catch {}
      }
      const list = Array.from(seen.values()).slice(0, 40);
      setPoiMarkers(list);

      if (list.length > 0) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const it of list) {
          const lat = it?.geometry?.location?.lat, lng = it?.geometry?.location?.lng;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
        if (minLat <= maxLat && minLng <= maxLng) {
          mapRef.current?.animateToRegion(
            {
              latitude: (minLat + maxLat) / 2,
              longitude: (minLng + maxLng) / 2,
              latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.2),
              longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.2),
            },
            500
          );
        }
      }
    },
    [routeCoords, distanceToRoute]
  );

  const onPoiPress = useCallback(async (it) => {
    const pid = it?.place_id || it?.id;
    const lat = it?.geometry?.location?.lat;
    const lng = it?.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setCandidateStop({
      lat, lng,
      name: it?.name || 'Seçilen yer',
      place_id: pid,
      rating: it?.rating ?? null,
      address: it?.vicinity || '',
    });

    try {
      if (pid) {
        const d = await getPlaceDetails(pid);
        setCandidateStop(prev =>
          prev && prev.place_id === pid
            ? {
                ...prev,
                lat: d?.geometry?.location?.lat ?? lat,
                lng: d?.geometry?.location?.lng ?? lng,
                name: d?.name || prev.name,
                address: d?.formatted_address || d?.vicinity || prev.address,
              }
            : prev
        );
      }
    } catch {}
  }, []);

  /* ---------- DURAK EKLEME (WAYPOINT) ---------- */
  const normalizePlaceToStop = useCallback(async (place) => {
    try {
      let lat, lng, name, place_id, address;

      if (typeof place === 'string') {
        const preds = await autocomplete(place);
        const pid = preds?.[0]?.place_id;
        if (!pid) return null;
        const d = await getPlaceDetails(pid);
        place_id = d?.place_id || pid;
        lat = d?.geometry?.location?.lat;
        lng = d?.geometry?.location?.lng;
        name = d?.name || preds?.[0]?.structured_formatting?.main_text || place;
        address = d?.formatted_address || preds?.[0]?.description || '';
      } else if (place?.geometry?.location || place?.coords || (Number.isFinite(place?.lat) && Number.isFinite(place?.lng))) {
        place_id = place?.place_id || place?.id || null;
        lat =
          place?.geometry?.location?.lat ??
          place?.coords?.latitude ??
          place?.lat;
        lng =
          place?.geometry?.location?.lng ??
          place?.coords?.longitude ??
          place?.lng;
        name =
          place?.name ||
          place?.structured_formatting?.main_text ||
          place?.description ||
          place?.address ||
          'Seçilen yer';
        address =
          place?.vicinity ||
          place?.formatted_address ||
          place?.structured_formatting?.secondary_text ||
          place?.address ||
          '';
      } else if (place?.place_id || place?.id) {
        const pid = place.place_id || place.id;
        const d = await getPlaceDetails(pid);
        place_id = d?.place_id || pid;
        lat = d?.geometry?.location?.lat;
        lng = d?.geometry?.location?.lng;
        name = d?.name || place?.name || 'Seçilen yer';
        address = d?.formatted_address || d?.vicinity || place?.description || '';
      } else if (candidateStop) {
        const { lat: clat, lng: clng, name: cname, place_id: cpid, address: caddr } = candidateStop;
        lat = clat; lng = clng; name = cname; place_id = cpid; address = caddr;
      } else {
        return null;
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, name, address, place_id: place_id || null };
    } catch {
      return null;
    }
  }, [candidateStop]);

  const applyPendingEditStop = useCallback((payload) => {
    if (!pendingEditOp || !payload) return;
    setDraftStops(prev => {
      if (!Array.isArray(prev) || prev.length < 2) return prev;
      const lastIdx = prev.length - 1;

      if (pendingEditOp.type === 'insert') {
        const idx = clamp(1, lastIdx, pendingEditOp.index);
        const next = [...prev];
        next.splice(idx, 0, payload);
        return next;
      }
      if (pendingEditOp.type === 'replace') {
        const idx = clamp(1, lastIdx - 1, pendingEditOp.index);
        const next = [...prev];
        next[idx] = payload;
        return next;
      }
      return prev;
    });
    setPendingEditOp(null);
    setAddStopOpen(false);
    setEditStopsOpen(true);
    setCandidateStop(null);
    setPoiMarkers([]);
  }, [pendingEditOp]);

  const insertOrAppendStop = useCallback(
    ({ lat, lng, name, place_id, address }) => {
      const payload = { lat, lng, name, place_id, address };
      const cur = Array.isArray(map.waypoints) ? map.waypoints : [];
      const wps = [...cur, payload];
      map.setWaypoints(wps);
      setCandidateStop(null);
      setAddStopOpen(false);
      setPoiMarkers([]);
      setMode('route');
      recalcRoute(map.selectedMode, wps);
    },
    [map.waypoints, recalcRoute, map.selectedMode, map]
  );

  const handleAddStopFlexible = useCallback(
    async (place) => {
      const payload = await normalizePlaceToStop(place);
      if (!payload) return;

      if (pendingEditOp) {
        applyPendingEditStop(payload);
      } else {
        insertOrAppendStop(payload);
        await saveHistoryObjects(['route_stop_history'], payload);
      }
    },
    [pendingEditOp, normalizePlaceToStop, applyPendingEditStop, insertOrAppendStop]
  );

  const handlePickStop = useCallback(
    async (place) => {
      try {
        const payload = await normalizePlaceToStop(place);
        if (!payload) return;
        if (pendingEditOp) {
          applyPendingEditStop(payload);
        } else {
          setCandidateStop(payload);
        }
      } catch {}
    },
    [normalizePlaceToStop, pendingEditOp, applyPendingEditStop]
  );

  const handleAddStopFromPOI = useCallback(
    async (place) => {
      await handleAddStopFlexible(place);
    },
    [handleAddStopFlexible]
  );

  const openEditStops = useCallback(() => {
    if (!map.fromLocation?.coords || !map.toLocation?.coords) return;

    const from = {
      ...toLL(map.fromLocation.coords),
      name: map.fromLocation?.description || 'Başlangıç',
      place_id: map.fromLocation?.key || null,
      address: map.fromLocation?.description || '',
    };
    const to = {
      ...toLL(map.toLocation.coords),
      name: map.toLocation?.description || 'Bitiş',
      place_id: map.toLocation?.key || null,
      address: map.toLocation?.description || '',
    };
    const wps = (map.waypoints || []).map(w => ({
      lat: w.lat ?? w.latitude,
      lng: w.lng ?? w.longitude,
      name: w.name,
      address: w.address,
      place_id: w.place_id,
    }));

    setDraftStops([from, ...wps, to]);
    setEditStopsOpen(true);
  }, [map.fromLocation, map.toLocation, map.waypoints]);

  /* --------------------------------- RENDER --------------------------------- */
  return (
    <View style={styles.container}>
      <MapView
        key={`cat-${map.categoryMarkers.length}`}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={map.region}
        onPress={handleMapPress}
        onPanDrag={() => { if (showSelectionHint) setShowSelectionHint(false); }}
        onRegionChangeComplete={onRegionChangeComplete}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled
        onPoiClick={(e) => {
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
            handleSelectOriginOnMap(e.nativeEvent.coordinate);
            return;
          }
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
            handleSelectDestinationOnMap(e.nativeEvent.coordinate);
            return;
          }
          map.handlePoiClick(e, {
            showOverlay: showOverlay,
            showFromOverlay: showFromOverlay,
            closeOverlays: () => { setShowOverlay(false); setShowFromOverlay(false); },
          });
        }}
        showsUserLocation={available}
      >
        {/* Explore marker’ları */}
        {mode === 'explore' && (
          <MapMarkers
            mode={mode}
            categoryMarkers={map.categoryMarkers}
            activeCategory={map.activeCategory}
            onMarkerPress={(placeId, coordinate, name) => {
              if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
                handleSelectOriginOnMap(coordinate);
              } else if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
                handleSelectDestinationOnMap(coordinate);
              } else {
                map.handleMarkerSelect(placeId, coordinate, name);
              }
            }}
            fromLocation={map.fromLocation}
          />
        )}

        {/* Tek seçilmiş POI marker’ı (explore) */}
        {!map.activeCategory && mode === 'explore' && map.marker?.coordinate && (
          <Marker
            coordinate={map.marker.coordinate}
            pinColor="#FF5A5F"
            tracksViewChanges={false}
            onPress={() => map.handleMarkerSelect(map.marker.place_id, map.marker.coordinate, map.marker.name)}
          >
            <MarkerCallout marker={map.marker} />
          </Marker>
        )}

        {/* From/To marker’ları */}
        {mode === 'route' && map.fromLocation?.coords && <Marker coordinate={map.fromLocation.coords} pinColor="blue" />}
        {mode === 'route' && map.toLocation?.coords && (
          <Marker coordinate={map.toLocation.coords} pinColor="#FF5A5F" tracksViewChanges={false} />
        )}

        {/* Waypoint marker’ları */}
        {mode === 'route' &&
          Array.isArray(map.waypoints) &&
          map.waypoints.map((w, idx) => {
            const lat = w.lat ?? w.latitude;
            const lng = w.lng ?? w.longitude;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return (
              <Marker key={`wp_${idx}_${w.place_id || `${lat}_${lng}`}`} coordinate={{ latitude: lat, longitude: lng }}>
                <View style={styles.wpDotOuter}>
                  <View style={styles.wpDotInner}>
                    <Text style={styles.wpNum}>{idx + 1}</Text>
                  </View>
                </View>
              </Marker>
            );
          })}

        {/* Aday durak */}
        {candidateStop && Number.isFinite(candidateStop.lat) && Number.isFinite(candidateStop.lng) && (
          <Marker coordinate={{ latitude: candidateStop.lat, longitude: candidateStop.lng }}>
            <View style={styles.candidateDotOuter}>
              <View style={styles.candidateDotInner} />
            </View>
            <Callout tooltip={Platform.OS === 'ios'}>
              <View style={styles.calloutCard}>
                <Text style={styles.calloutTitle} numberOfLines={1}>{candidateStop.name || 'Seçilen yer'}</Text>
                {!!candidateStop.address && <Text style={styles.calloutSub} numberOfLines={1}>{candidateStop.address}</Text>}
                <TouchableOpacity
                  style={styles.calloutCta}
                  onPress={() => handleAddStopFlexible(candidateStop)}
                >
                  <Text style={styles.calloutCtaText}>Durak ekle</Text>
                </TouchableOpacity>
              </View>
            </Callout>
          </Marker>
        )}

        {/* Rota üzerindeki POI’ler */}
        {stablePoiList.map((p) => {
          const lat = p?.geometry?.location?.lat, lng = p?.geometry?.location?.lng;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
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
                onPoiPress(p);
              }}
              onCalloutPress={() => handleAddStopFlexible(p)}
            >
              <View style={styles.poiDotOuter}><Text style={styles.poiEmoji}>📍</Text></View>
              <Callout tooltip={Platform.OS === 'ios'}>
                <View style={styles.calloutCard}>
                  <Text style={styles.calloutTitle} numberOfLines={1}>{p?.name || 'Seçilen yer'}</Text>
                  <Text style={styles.calloutSub} numberOfLines={1}>
                    {(p?.rating ? `★ ${p.rating} • ` : '') + (p?.vicinity || '')}
                  </Text>
                  <TouchableOpacity style={styles.calloutCta} onPress={() => handleAddStopFlexible(p)} activeOpacity={0.8}>
                    <Text style={styles.calloutCtaText}>Durak ekle</Text>
                  </TouchableOpacity>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* Rota polylineleri */}
        <MapRoutePolyline
          key={map.selectedMode}
          routes={map.routeOptions[map.selectedMode] || []}
          onRouteSelect={(selected) => {
            const updated = (map.routeOptions[map.selectedMode] || []).map(r => ({ ...r, isPrimary: r.id === selected.id }));
            map.setRouteOptions(prev => ({ ...prev, [map.selectedMode]: updated }));
            setRouteCoords(selected.decodedCoords);
            setRouteInfo({ distance: selected.distance, duration: selected.duration });
            mapRef.current?.fitToCoordinates(selected.decodedCoords, {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            });
            requestAnimationFrame(presentRouteSheet);
          }}
        />
      </MapView>

      {/* Haritadan seçim uyarısı */}
      {showSelectionHint && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.transparentOverlay} pointerEvents="none" />
          <View style={styles.selectionPromptContainer} pointerEvents="none">
            <Text style={styles.selectionPromptText}>Haritaya dokunarak bir konum seçin</Text>
          </View>
        </View>
      )}

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* EXPLORE */}
        {mode === 'explore' && !map.fromLocation && (
          <>
            <MapHeaderControls
              query={map.query}
              onQueryChange={map.setQuery}
              onPlaceSelect={map.handleSelectPlace}
              onCategorySelect={map.handleCategorySelect}
              mapMovedAfterDelay={mapMovedAfterDelay}
              loadingCategory={map.loadingCategory}
              onSearchArea={map.handleSearchThisArea}
              activeCategory={map.activeCategory}
            />

            {map.activeCategory && map.categoryMarkers.length > 0 && (
              <CategoryList
                data={map.categoryMarkers}
                activePlaceId={map.marker?.place_id}
                onSelect={map.handleSelectPlace}
                userCoords={coords}
              />
            )}

            <PlaceDetailSheet
              ref={sheetRef}
              marker={map.marker}
              routeInfo={map.routeInfo}
              snapPoints={['30%', '60%', '75%', '90%']}
              onGetDirections={onGetDirectionsPress}
              overrideCtaLabel={
                picker
                  ? (picker.which === 'start'
                      ? 'Başlangıç ekle'
                      : picker.which === 'end'
                        ? 'Bitiş ekle'
                        : 'Konaklama ekle')
                  : undefined
              }
              overrideCtaOnPress={
                picker
                  ? () => {
                      const p = map.marker || {};
                      const loc =
                        p.location ||
                        p.geometry?.location ||
                        (p.coordinate && { lat: p.coordinate.latitude, lng: p.coordinate.longitude }) ||
                        null;

                      const hub = {
                        name: p.name || p.title || 'Seçilen Nokta',
                        place_id: p.place_id || p.id || null,
                        location: loc,
                      };

                      const payload = { which: picker.which, cityKey: picker.cityKey, hub };
                      navigation.navigate('Gezilerim', {
                        screen: 'CreateTripWizard',
                        params: { pickFromMap: payload },
                      });
                    }
                  : undefined
              }
              onDismiss={() => { map.setMarker(null); map.setQuery(''); }}
            />
          </>
        )}

        {/* get directions – nereden overlay */}
        {showFromOverlay && (
          <GetDirectionsOverlay
            visible={showFromOverlay}
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey="search_history"
            favoritesKey="favorite_places"
            onCancel={() => setShowFromOverlay(false)}
            onFromSelected={handleFromSelected}
            onMapSelect={() => {
              setShowFromOverlay(false);
              setMode('route');
              setOverlayContext('from');
              map.setFromLocation(null);
              setIsSelectingFromOnMap(true);
              setShowSelectionHint(true);
              if (map.marker) {
                map.setToLocation({ coords: map.marker.coordinate, description: map.marker.name });
              }
            }}
          />
        )}

        {/* ROUTE modunda nereden/nereye girişleri */}
        {mode === 'route' && (
          <View style={styles.routeControls}>
            <TouchableOpacity onPress={handleReverseRoute} style={styles.reverseCornerButton}>
              <Text style={styles.reverseIcon}>⇄</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Nereden</Text>
            <TouchableOpacity
              style={styles.inputButton}
              onPress={() => { setOverlayContext('from'); setShowOverlay(true); }}
            >
              <Text style={styles.inputText}>{map.fromLocation?.description || 'Konum seçin'}</Text>
            </TouchableOpacity>

            <View style={{ height: 10 }} />

            <Text style={styles.label}>Nereye</Text>
            <TouchableOpacity
              style={styles.inputButton}
              onPress={() => { setOverlayContext('to'); setShowOverlay(true); }}
            >
              <Text style={styles.inputText}>{map.toLocation?.description || 'Nereye?'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Ortak overlay */}
        {showOverlay && (
          <GetDirectionsOverlay
            visible={showOverlay}
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey={`search_history_${overlayContext}`}
            favoritesKey={`favorite_places_${overlayContext}`}
            onCancel={() => setShowOverlay(false)}
            onFromSelected={
              overlayContext === 'from'
                ? (place) => { handleFromSelected(place); setShowOverlay(false); }
                : undefined
            }
            onToSelected={
              overlayContext === 'to'
                ? (place) => { handleToSelected(place); setShowOverlay(false); }
                : undefined
            }
            onMapSelect={() => {
              setShowOverlay(false);
              setIsSelectingFromOnMap(true);
            }}
          />
        )}

        {/* Route Info Sheet */}
        <RouteInfoSheet
          ref={sheetRefRoute}
          distance={routeInfo?.distance}
          duration={routeInfo?.duration}
          fromLocation={map.fromLocation}
          toLocation={map.toLocation}
          selectedMode={map.selectedMode}
          routeOptions={map.routeOptions}
          waypoints={map.waypoints || []}
          snapPoints={['30%']}
          onCancel={handleCancelRoute}
          onModeChange={(m) => {
            map.handleSelectRoute(m);
            setTimeout(() => recalcRoute(m), 0);
          }}
          onStart={() => {
            dismissRouteSheet();
            setMode('explore');
            setRouteInfo(null);
            setRouteCoords([]);
            map.setRouteOptions({});
            map.setSelectedMode('driving');
          }}
        >
          <View style={styles.routeSheetHeader}>
            <TouchableOpacity onPress={handleCancelRoute} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </RouteInfoSheet>

        {/* Çoklu durak FAB & düzenle */}
        {mode === 'route' && (
          <>
            <TouchableOpacity
              style={styles.addStopFab}
              onPress={() => setAddStopOpen(true)}
              activeOpacity={0.9}
            >
              <Text style={styles.addStopFabText}>＋</Text>
            </TouchableOpacity>

            {Array.isArray(map.waypoints) && map.waypoints.length > 0 && (
              <TouchableOpacity
                style={styles.editStopsBtn}
                onPress={openEditStops}
                activeOpacity={0.9}
              >
                <Text style={styles.editStopsText}>Durakları düzenle ({map.waypoints.length})</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </SafeAreaView>

      {/* AddStopOverlay */}
      <AddStopOverlay
        visible={addStopOpen}
        onClose={() => { setAddStopOpen(false); setCandidateStop(null); setPoiMarkers([]); setPendingEditOp(null); }}
        onCategorySelect={async (type) => {
          await fetchPlacesAlongRoute({ type, noCorridor: false });
        }}
        onQuerySubmit={async (text) => {
          await fetchPlacesAlongRoute({ text, noCorridor: true });
        }}
        onPickStop={handlePickStop}
        onAddStop={handleAddStopFlexible}
        routeBounds={routeBounds}
        historyKey="route_stop_history"
        favoritesKey="route_stop_favorites"
      />

      {/* Durakları Düzenle */}
      <EditStopsOverlay
        visible={editStopsOpen}
        stops={draftStops}
        onClose={() => { setEditStopsOpen(false); setDraftStops([]); setPendingEditOp(null); }}
        onConfirm={confirmEditStops}
        onDragEnd={(from, to) => setDraftStops(prev => {
          if (from === to) return prev;
          const next = [...prev];
          const [it] = next.splice(from, 1);
          next.splice(to, 0, it);
          return next;
        })}
        onDelete={(i) => setDraftStops(prev => {
          const last = (prev?.length ?? 0) - 1;
          if (i <= 0 || i >= last) return prev; // Başlangıç/Bitiş silinmez
          return prev.filter((_, idx) => idx !== i);
        })}
        onInsertAt={(i) => {
          const last = (draftStops?.length ?? 0) - 1;   // Bitiş indeksi
          const target = clamp(1, last, i - 1);
          setPendingEditOp({ type: 'insert', index: target });
          setAddStopOpen(true);
          setEditStopsOpen(false);
        }}
        onReplaceAt={(i) => {
          const last = (draftStops?.length ?? 0) - 1;
          if (i <= 0 || i >= last) return;
          setPendingEditOp({ type: 'replace', index: i });
          setAddStopOpen(false);
          setAddStopOpen(true);
          setEditStopsOpen(false);
        }}
      />

      {/* opsiyonel nav banner */}
      {isNavigating && firstManeuver && (
        <NavigationBanner
          maneuver={firstManeuver}
          duration={routeInfo?.duration}
          distance={routeInfo?.distance}
          onCancel={handleCancelRoute}
        />
      )}

      {/* genel overlayler */}
      <MapOverlays
        available={available}
        coords={coords}
        onRetry={refreshLocation}
        onRecenter={(region) => {
          map.setRegion(region);
          mapRef.current?.animateToRegion(region, 500);
        }}
      />
    </View>
  );
}

/* -------------------------------- Styles -------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject, zIndex: 0 },

  routeControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 50,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    elevation: 4,
  },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  inputButton: {
    height: 48, backgroundColor: '#f9f9f9', borderColor: '#ccc',
    borderWidth: 1, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12,
  },
  inputText: { fontSize: 16, color: '#333' },

  transparentOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
  selectionPromptContainer: { position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  selectionPromptText: { backgroundColor: 'rgba(255,255,255,0.9)', padding: 12, borderRadius: 8, fontSize: 16, color: '#333', textAlign: 'center' },

  routeSheetHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  closeButton: { padding: 8 },
  closeButtonText: { fontSize: 18, fontWeight: 'bold', color: '#666' },

  reverseCornerButton: {
    position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center', zIndex: 10, elevation: 3,
  },
  reverseIcon: { fontSize: 18, fontWeight: '600', color: '#333' },

  addStopFab: {
    position: 'absolute', right: 16, bottom: 300,
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#1E88E5',
    alignItems: 'center', justifyContent: 'center', elevation: 8,
  },
  addStopFabText: { fontSize: 26, color: '#fff', fontWeight: '800', marginTop: -2 },

  editStopsBtn: {
    position: 'absolute', right: 16, bottom: 250,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    elevation: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  editStopsText: { fontWeight: '700', color: '#111' },

  wpDotOuter: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.18)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,193,7,0.5)',
  },
  wpDotInner: {
    minWidth: 18, height: 32, borderRadius: 9,
    backgroundColor: '#FFC107', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  wpNum: { fontSize: 11, fontWeight: '700', color: '#111' },

  candidateDotOuter: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(220,53,69,0.18)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(220,53,69,0.5)',
  },
  candidateDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC3545' },

  poiDotOuter: {
    backgroundColor: 'white', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 6,
    elevation: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  poiEmoji: { fontSize: 16 },

  calloutCard: {
    minWidth: 240, maxWidth: 340,
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    elevation: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  calloutTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  calloutSub: { marginTop: 4, fontSize: 12, color: '#555' },
  calloutCta: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#E6F4EA', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  calloutCtaText: { fontSize: 13, fontWeight: '700', color: '#111' },
});
