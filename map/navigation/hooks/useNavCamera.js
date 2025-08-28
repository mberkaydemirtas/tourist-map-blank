import { useCallback, useEffect, useRef, useState } from 'react';

export default function useNavCamera({
  nav,                           // useNavigationLogic çıktısı
  distanceToManeuver,            // metre
  followBackSuppressedRef,       // { current: boolean }
}) {
  const DEFAULT_ZOOM = 18.8;
  const DEFAULT_PITCH = 52;

  const [camZoom, setCamZoom] = useState(DEFAULT_ZOOM);
  const [camPitch, setCamPitch] = useState(DEFAULT_PITCH);
  const camZoomRef = useRef(camZoom);
  const camPitchRef = useRef(camPitch);
  useEffect(() => { camZoomRef.current = camZoom; }, [camZoom]);
  useEffect(() => { camPitchRef.current = camPitch; }, [camPitch]);

  const [isFollowing, setIsFollowing] = useState(true);
  const [isMapTouched, setIsMapTouched] = useState(false);

  // nav kimliğini sabitle
  const navRef = useRef(nav);
  useEffect(() => { navRef.current = nav; }, [nav]);

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

  // Kullanıcı etkileşimleri (navRef ile sabit)
  const onMapPress = useCallback(() => {
    setIsMapTouched(true);
    navRef.current?.setUserInteracting?.(true);
    if (!followBackSuppressedRef?.current) scheduleFollowBack();
  }, [scheduleFollowBack, followBackSuppressedRef]);

  const onPanDrag = useCallback(() => {
    setIsMapTouched(true);
    setIsFollowing(false);
    navRef.current?.setUserInteracting?.(true);
    if (!followBackSuppressedRef?.current) scheduleFollowBack();
  }, [scheduleFollowBack, followBackSuppressedRef]);

  const goFollowNow = useCallback(() => {
    navRef.current?.recenter?.();
    setIsFollowing(true);
    setIsMapTouched(false);
  }, []);

  // Manevraya yaklaşınca kamera z/p ayarı
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

  return {
    // state
    camZoom, camPitch,
    isFollowing, setIsFollowing,
    isMapTouched, setIsMapTouched,
    // handlers
    onMapPress, onPanDrag, scheduleFollowBack, goFollowNow,
    // follow hold
    pauseFollowing, followHoldUntilRef,
  };
}
