import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Kamera takip hook'u (navigasyon):
 * - "Hizala" aktifken kullanıcı haritayı kaydırana kadar kamerayı takipte tutar
 * - Follow modunda merkez: konumun lookahead (ileri bakış) noktası
 * - Manevraya yaklaşınca zoom/pitch ayarı
 * - Kullanıcı kaydırırsa follow kapatılır; scheduleFollowBack ile belirli süre sonra geri açılabilir
 *
 * Gerekli props:
 * - mapRef: React ref to MapView
 * - location: {latitude, longitude, heading?}
 * - distanceToManeuver: metre (zoom/pitch için)
 * - followBackSuppressedRef: { current: boolean } (bazı animasyonlarda geri dönmeyi engellemek için)
 */
export default function useNavCamera({
  mapRef,
  location,                      // { latitude, longitude, heading? }
  distanceToManeuver,            // metre
  followBackSuppressedRef,       // { current: boolean }
  // Opsiyonlar:
  defaultZoom = 18.8,
  defaultPitch = 52,
  lookaheadMeters = 100,
  animateMs = 500,
  throttleMs = 300,
} = {}) {
  const [camZoom, setCamZoom] = useState(defaultZoom);
  const [camPitch, setCamPitch] = useState(defaultPitch);
  const camZoomRef = useRef(camZoom);
  const camPitchRef = useRef(camPitch);
  useEffect(() => { camZoomRef.current = camZoom; }, [camZoom]);
  useEffect(() => { camPitchRef.current = camPitch; }, [camPitch]);

  const [isFollowing, setIsFollowing] = useState(true);
  const [isMapTouched, setIsMapTouched] = useState(false);

  // “birazdan follow’a dön” zamanlayıcısı
  const followBackTimerRef = useRef(null);
  const scheduleFollowBack = useCallback(() => {
    if (followBackSuppressedRef?.current) return;
    if (followBackTimerRef.current) clearTimeout(followBackTimerRef.current);
    followBackTimerRef.current = setTimeout(() => {
      if (followBackSuppressedRef?.current) return;
      setIsFollowing(true);
      setIsMapTouched(false);
    }, 8000);
  }, [followBackSuppressedRef]);
  useEffect(() => () => { if (followBackTimerRef.current) clearTimeout(followBackTimerRef.current); }, []);

  // Follow’u kısa süre bloke et (örn. fitBounds sırasında)
  const followHoldUntilRef = useRef(0);
  const pauseFollowing = useCallback((ms = 2500) => {
    followHoldUntilRef.current = Date.now() + ms;
  }, []);

  // Kullanıcı etkileşimleri
  const onMapPress = useCallback(() => {
    setIsMapTouched(true);
    setIsFollowing(false);
    if (!followBackSuppressedRef?.current) scheduleFollowBack();
  }, [scheduleFollowBack, followBackSuppressedRef]);

  const onPanDrag = useCallback(() => {
    setIsMapTouched(true);
    setIsFollowing(false);
    if (!followBackSuppressedRef?.current) scheduleFollowBack();
  }, [scheduleFollowBack, followBackSuppressedRef]);

  const goFollowNow = useCallback(() => {
    // Kullanıcı “Hizala”ya basınca
    setIsFollowing(true);
    setIsMapTouched(false);
  }, []);

  // Lookahead hesaplayıcı
  const destinationPoint = useCallback((lat, lng, bearingDeg, distMeters) => {
    const R = 6371000;
    const δ = distMeters / R; // angular distance in radians
    const θ = (bearingDeg ?? 0) * Math.PI / 180;
    const φ1 = lat * Math.PI / 180;
    const λ1 = lng * Math.PI / 180;

    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    return {
      latitude: (φ2 * 180) / Math.PI,
      longitude: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
    };
  }, []);

  // Manevraya yaklaşınca kamera z/p ayarı
  useEffect(() => {
    if (!isFollowing) return;
    const d = distanceToManeuver;
    let z = defaultZoom, p = defaultPitch;
    if (Number.isFinite(d)) {
      if (d <= 50)       { z = 19.2; p = 60; }
      else if (d <= 160) { z = 18.9; p = 55; }
      else               { z = 18.6; p = 52; }
    }
    if (Math.abs(z - camZoomRef.current) > 0.02) setCamZoom(z);
    if (Math.abs(p - camPitchRef.current) > 0.5) setCamPitch(p);
  }, [distanceToManeuver, isFollowing, defaultZoom, defaultPitch]);

  // Kamera animasyonlarını throttle et
  const lastAnimAtRef = useRef(0);

  // Konum/heading değiştikçe kamerayı lookahead noktaya taşı
  useEffect(() => {
    if (!isFollowing) return;
    if (!mapRef?.current) return;
    if (!location?.latitude || !location?.longitude) return;

    const now = Date.now();
    if (now - lastAnimAtRef.current < throttleMs) return;
    if (followHoldUntilRef.current > now) return;
    lastAnimAtRef.current = now;

    const center = destinationPoint(
      location.latitude,
      location.longitude,
      location.heading ?? 0,
      lookaheadMeters
    );

    try {
      mapRef.current.animateCamera(
        {
          center,
          heading: location.heading ?? 0,
          pitch: camPitchRef.current,
          zoom: camZoomRef.current,
        },
        { duration: animateMs }
      );
    } catch {}
  }, [
    isFollowing,
    mapRef,
    location?.latitude,
    location?.longitude,
    location?.heading,
    lookaheadMeters,
    animateMs,
    throttleMs,
    destinationPoint,
  ]);

  return {
    // state
    camZoom, camPitch,
    isFollowing, setIsFollowing,
    isMapTouched, setIsMapTouched,
    // handlers
    onMapPress, onPanDrag, goFollowNow, scheduleFollowBack,
    // follow hold
    pauseFollowing, followHoldUntilRef,
  };
}
