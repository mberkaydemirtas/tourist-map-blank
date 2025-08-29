import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { snapToPolyline, pathLength, metersBetween } from './navMath';

/**
 * @typedef {{latitude:number, longitude:number, speed?:number, heading?:number}} LatLng
 * @typedef {{distance:number, duration:number}} RouteInfo
 */

/**
 * Navigation core (konum besleme + snap + takip + ETA)
 */
export function useNavigationLogic({
  mapRef,
  routeCoords,
  routeInfo,
  selectedMode = 'driving',
  offRouteThresholdM = 50,
  offRouteConsecutive = 2,
  onOffRoute,
  voice = false,
  externalFeed = false,
  internalFollow = false,
}) {
  // --- State ---
  const [isActive, setIsActive] = useState(false);
  const [follow, setFollow] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(!!voice);

  const [location, setLocation] = useState /** @type {LatLng|null} */ (null);
  const [snapped, setSnapped] = useState(null); // {point, distanceToSegment, cumulativeM}
  const [remainingM, setRemainingM] = useState(0);
  const [remainingS, setRemainingS] = useState(0);
  const [eta, setEta] = useState(null); // Date
  const [speedKmh, setSpeedKmh] = useState(0);

  // --- Refs (kimlik sabitleme) ---
  const watcherRef = useRef(null);
  const lastAnnounceRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const lastOffRouteAtRef = useRef(0);

  const camThrottleRef = useRef(0);
  const lastCamCenterRef = useRef /** @type {LatLng|null} */ (null);
  const isUserInteractingRef = useRef(false);

  const routeCumDistRef = useRef([]);  // [0, d01, d01+d12, ...]
  const totalRef = useRef(0);          // toplam hat uzunluğu (m)

  const lastLocRef = useRef(null);

  // Dep’leri ref’e aynala (handleLocationUpdate’ı stabil tutmak için)
  const onOffRouteRef = useRef(onOffRoute);
  useEffect(() => { onOffRouteRef.current = onOffRoute; }, [onOffRoute]);

  const isActiveRef = useRef(isActive);
  const followRef = useRef(follow);
  const voiceRef = useRef(voiceEnabled);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { voiceRef.current = voiceEnabled; }, [voiceEnabled]);

  const routeCoordsRef = useRef(routeCoords);
  useEffect(() => { routeCoordsRef.current = routeCoords; }, [routeCoords]);

   const internalFollowRef = useRef(internalFollow);
   useEffect(() => { internalFollowRef.current = internalFollow; }, [internalFollow]);
  // --- Toplam mesafe ---
  const totalM = useMemo(() => pathLength(routeCoords), [routeCoords]);

  // --- Ortalama hız (rota bilgisi → m/s) ---
  const avgSpeedMsFromRoute = useMemo(() => {
    const dur = Math.max(1, Number(routeInfo?.duration || 0));
    const dist = Math.max(1, Number(routeInfo?.distance || totalM || 1));
    return dist / dur; // m/s
  }, [routeInfo, totalM]);

  const avgSpeedRef = useRef(avgSpeedMsFromRoute);
  useEffect(() => { avgSpeedRef.current = avgSpeedMsFromRoute; }, [avgSpeedMsFromRoute]);

  // --- Rota değiştiğinde kümülatif mesafeyi hazırla ---
  useEffect(() => {
    const rc = Array.isArray(routeCoords) ? routeCoords : [];
    const cum = new Array(rc.length).fill(0);
    let acc = 0;
    for (let i = 1; i < rc.length; i++) {
      const d = metersBetween(rc[i - 1], rc[i]);
      if (Number.isFinite(d)) acc += d;
      cum[i] = acc;
    }
    routeCumDistRef.current = cum;
    totalRef.current = acc;
  }, [routeCoords]);

  // --- Throttle yardımcı ---
  const throttle = useCallback((fn, wait = 300) => {
    let t, last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last > wait) {
        last = now; fn(...args);
      } else {
        clearTimeout(t);
        t = setTimeout(() => { last = Date.now(); fn(...args); }, wait);
      }
    };
  }, []);

  // --- Kamera animatörü ---
  const animateFollow = useMemo(
    () =>
      throttle((center, headingDeg = 0, zoom = 17, pitch = 0) => {
        if (mapRef?.current?.animateCamera) {
          mapRef.current.animateCamera(
            { center, heading: headingDeg, pitch, zoom },
            { duration: 300 }
          );
        } else if (mapRef?.current?.animateToRegion) {
          mapRef.current.animateToRegion(
            { ...center, latitudeDelta: 0.005, longitudeDelta: 0.005 },
            300
          );
        }
      }, 250),
    [mapRef, throttle]
  );

  const animateFollowRef = useRef(animateFollow);
  useEffect(() => { animateFollowRef.current = animateFollow; }, [animateFollow]);

  // --- Lookahead yardımcıları (hizalama için) ---
  const destinationPoint = useCallback((lat, lng, bearingDegV, distM) => {
    const R = 6371e3, δ = distM / R, θ = (bearingDegV * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180;
    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
    let λ2 = λ1 + Math.atan2(y, x);
    λ2 = ((λ2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
  }, []);

  const computeLookAhead = useCallback((speedMps, distToManeuver) => {
    const v = Number.isFinite(speedMps) ? speedMps : 8;   // m/s
    let ahead = 60 + v * 6;                               // temel ileri görüş
    if (Number.isFinite(distToManeuver)) {
      ahead = Math.min(ahead, Math.max(60, distToManeuver * 0.6));
    }
    return Math.max(60, Math.min(300, Math.round(ahead)));
  }, []);

  // --- KONUM GÜNCELLEME (STABİL) ---
  const handleLocationUpdate = useCallback((loc) => {
    if (!loc?.coords) return;

    lastLocRef.current = loc;

    const p = {
      latitude: Number(loc.coords.latitude),
      longitude: Number(loc.coords.longitude),
    };

    // 1) Konum state (gereksiz render’ı engelle)
    setLocation(prev => {
      if (prev &&
          prev.latitude === p.latitude &&
          prev.longitude === p.longitude &&
          (prev.speed ?? 0) === (Number.isFinite(loc.coords.speed) ? loc.coords.speed : 0) &&
          (prev.heading ?? 0) === (Number.isFinite(loc.coords.heading) ? loc.coords.heading : 0)) {
        return prev;
      }
      return {
        ...p,
        speed: Number.isFinite(loc.coords.speed) ? loc.coords.speed : 0,
        heading: Number.isFinite(loc.coords.heading) ? loc.coords.heading : 0,
      };
    });

    setSpeedKmh(
      Number.isFinite(loc.coords.speed) ? Math.round(loc.coords.speed * 3.6) : 0
    );

    const rc = routeCoordsRef.current;
    if (!Array.isArray(rc) || rc.length < 2) return;

    // 2) Snap
    const s = snapToPolyline(p, rc);
    const snappedPoint =
      s?.snapped || s?.point
        ? {
            latitude: Number(s.snapped?.latitude ?? s.point?.latitude),
            longitude: Number(s.snapped?.longitude ?? s.point?.longitude),
          }
        : null;

    let alongM = Number.isFinite(s?.cumulativeM) ? s.cumulativeM : 0;
    if (!Number.isFinite(alongM)) {
      const idx = Math.max(0, Math.min((s?.index ?? 0), rc.length - 2));
      const segLen = metersBetween(rc[idx], rc[idx + 1]);
      const base = routeCumDistRef.current[idx] || 0;
      alongM = base + (Number.isFinite(segLen) ? segLen * (s?.t ?? 0) : 0);
    }

    setSnapped(prev => {
      const distToSeg = Number.isFinite(s?.distM) ? s.distM : (s?.distanceToSegment ?? Infinity);
      if (prev &&
          prev.point?.latitude === snappedPoint?.latitude &&
          prev.point?.longitude === snappedPoint?.longitude &&
          prev.cumulativeM === alongM &&
          prev.distanceToSegment === distToSeg) {
        return prev;
      }
      return {
        point: snappedPoint,
        distanceToSegment: distToSeg,
        cumulativeM: alongM,
      };
    });

    // 3) Off-route (ardışık ölçüm + cooldown)
    const distToSeg = Number.isFinite(s?.distM) ? s.distM : s?.distanceToSegment;
    if (Number.isFinite(distToSeg)) {
      if (distToSeg > offRouteThresholdM) offRouteCountRef.current += 1;
      else offRouteCountRef.current = Math.max(0, offRouteCountRef.current - 1);

      const enough = offRouteCountRef.current >= (offRouteConsecutive ?? 2);
      const now = Date.now();
      const cooled = now - (lastOffRouteAtRef.current || 0) > 15_000;

      if (enough && cooled && typeof onOffRouteRef.current === 'function') {
        lastOffRouteAtRef.current = now;
        offRouteCountRef.current = 0;
        onOffRouteRef.current({ location: p, distanceToRoute: distToSeg });
      }
    }

    // 4) kalan mesafe/süre / ETA
    const totalMLocal =
      totalRef.current ??
      routeCumDistRef.current[routeCumDistRef.current.length - 1] ??
      0;

    const remainM = Math.max(0, totalMLocal - alongM);
    setRemainingM(remainM);

    const currentSpeed =
      Number.isFinite(loc.coords.speed) && loc.coords.speed > 0
        ? loc.coords.speed
        : 0; // m/s
    const baseSpeed =
      Number.isFinite(avgSpeedRef.current) && avgSpeedRef.current > 0
        ? avgSpeedRef.current
        : 12.5; // ~45 km/h fallback
    const modelSpeed = Math.max(currentSpeed, baseSpeed);
    const remainS = modelSpeed > 0 ? Math.round(remainM / modelSpeed) : null;

    setRemainingS(remainS);
    setEta(Number.isFinite(remainS) ? new Date(Date.now() + remainS * 1000) : null);

    // 5) Kamera takibi (ref’ler üzerinden)
    if (internalFollowRef.current && isActiveRef.current && followRef.current && !isUserInteractingRef.current) {
      const now = Date.now();
      if (now - (camThrottleRef.current || 0) > 140) { // ~7fps
        camThrottleRef.current = now;

        const target = snappedPoint || p;
        const movedEnough =
          !lastCamCenterRef.current ||
          metersBetween(lastCamCenterRef.current, target) > 3;

        if (movedEnough && Number.isFinite(loc.coords.heading)) {
          animateFollowRef.current?.(target, loc.coords.heading);
          lastCamCenterRef.current = target;
        }
      }
    }

    // 6) Basit anons (opsiyonel)
    if (voiceRef.current && Number.isFinite(remainS)) {
      const now = Date.now();
      if (now - (lastAnnounceRef.current || 0) > 30_000) {
        lastAnnounceRef.current = now;
        const min = Math.max(1, Math.round(remainS / 60));
        try {
          Speech.stop();
          Speech.speak(`${min} dakikada varış`, {
            language: 'tr-TR',
            pitch: 1.0,
            rate: 1.0,
          });
        } catch {}
      }
    }
  }, []); // ❗ Tamamen stabil

  // --- Watcher başlat ---
  const startNavigation = useCallback(async () => {
    if (!routeCoordsRef.current?.length) return;

    if (externalFeed) {
      setIsActive(true);
      setFollow(false);
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const cur = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    handleLocationUpdate(cur);

    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 1000,
        distanceInterval: selectedMode === 'walking' ? 2 : 5,
      },
      handleLocationUpdate
    );
    setIsActive(true);
    setFollow(true);
  }, [externalFeed, handleLocationUpdate, selectedMode]);

  // --- Stop ---
  const stopNavigation = useCallback(() => {
    setIsActive(false);
    if (watcherRef.current) {
      watcherRef.current.remove?.();
      watcherRef.current = null;
    }
  }, []);

  // --- Recenter ---
  const recenter = useCallback(() => {
    const sp = snapped?.point;
    if (sp) {
      animateFollowRef.current?.(sp, 0);
    } else if (routeCoordsRef.current?.length && mapRef?.current?.fitToCoordinates) {
      mapRef.current.fitToCoordinates(routeCoordsRef.current, {
        edgePadding: { top: 60, bottom: 260, left: 40, right: 40 },
        animated: true,
      });
    }
  }, [mapRef, snapped?.point]);

  // --- Temizlik ---
  useEffect(() => () => stopNavigation(), [stopNavigation]);

  // --- Rota değişince tek frame hesapla ---
  useEffect(() => {
    if (!routeCoords?.length || !location) return;
    handleLocationUpdate({ coords: { ...location, speed: 0.5, heading: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCoords]);

  // --- Dışarıdan: kullanıcı etkileşimi bayrağı ---
  const setUserInteracting = useCallback((v) => {
    isUserInteractingRef.current = !!v;
  }, []);

  // --- HIZALA / GO FOLLOW NOW ---
  const alignNow = useCallback(({ distToManeuver, heading, pitch } = {}) => {
    const cur = lastLocRef.current?.coords;
    if (!cur) return;

    setIsActive(true);
    setFollow(true);

    const hdg =
      Number.isFinite(heading) ? heading :
      Number.isFinite(cur.heading) ? cur.heading : 0;

    const speed = Number.isFinite(cur.speed) ? cur.speed : 0;
    const lookAheadM = computeLookAhead(speed, distToManeuver);

    const ahead = destinationPoint(cur.latitude, cur.longitude, hdg, lookAheadM);

    // manevraya yakınken biraz daha yakın zoom
    let targetZoom = 18.6;
    if (Number.isFinite(distToManeuver)) {
      if (distToManeuver <= 50) targetZoom = 19.2;
      else if (distToManeuver <= 160) targetZoom = 18.9;
    }
      // pitch yoksa manevra mesafesine göre mantıklı bir açı seç
   let targetPitch = Number.isFinite(pitch) ? pitch : 52;
   if (!Number.isFinite(pitch) && Number.isFinite(distToManeuver)) {
     if (distToManeuver <= 50)      targetPitch = 60;
     else if (distToManeuver <= 160) targetPitch = 55;
     else                            targetPitch = 52;
   }

   animateFollowRef.current?.({ latitude: ahead.lat, longitude: ahead.lng }, hdg, targetZoom, targetPitch);
  }, [computeLookAhead, destinationPoint]);

  // --- Harici besleme ---
  const ingestExternalLocation = useCallback((raw) => {
    if (!raw) return;
    const loc = {
      coords: {
        latitude: raw.latitude,
        longitude: raw.longitude,
        speed: raw.speed ?? 0,
        heading: raw.heading ?? 0,
      },
    };
    handleLocationUpdate(loc);
  }, [handleLocationUpdate]);

  return {
    // state
    isActive,
    follow, setFollow,
    voiceEnabled, setVoiceEnabled,
    location,
    snapped,        // {point, distanceToSegment, cumulativeM}
    remainingM,
    remainingS,
    eta,            // Date
    speedKmh,
    totalM,

    // actions
    startNavigation,
    stopNavigation,
    recenter,

    // kontrol
    activate: () => { setIsActive(true); setFollow(true); },
    ingestExternalLocation,

    // yeni: hizala & etkileşim bayrağı
    alignNow,
    goFollowNow: alignNow,
    setUserInteracting,
  };
}
