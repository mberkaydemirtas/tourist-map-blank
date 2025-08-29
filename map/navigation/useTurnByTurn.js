// src/navigation/useTurnByTurn.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Turn-by-turn manevra, ses ve haptik kontrolü.
 *
 * Parametreler:
 *  - steps: sağlayıcı adım listesi
 *  - heading: mevcut baş yönü (derece)
 *  - location: {latitude, longitude, speed?, heading?}  (useNavigationLogic.location)
 *  - routeCoordsRef: polyline referansı (fallback mesafe hesapları için)
 *  - speak: (text:string)=>void
 *  - buzz: ()=>Promise<void>
 *  - helpers: ekranda zaten olan yardımcılar
 *  - onArrive?: ()=>void
 */
export default function useTurnByTurn({
  steps = [],
  heading,
  location,
  routeCoordsRef,
  speak,
  buzz,
  helpers,
  onArrive,
}) {
  const {
    getDistanceMeters,
    getManeuverTarget,
    getStepDistanceValue,
    getStepDurationValue,
    formatInstructionTR,
    formatInstructionRelativeTR,
    shortDirectiveTR,
    getTwoStageThresholds,
    calcRemaining,
  } = helpers || {};

  // --- State ---
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToManeuver, setDistanceToManeuver] = useState(null);
  const [liveRemain, setLiveRemain] = useState({ dist: null, sec: null });
  const [bannerStep, setBannerStep] = useState(null); // geçici banner step (ilk adım için)

  // --- Refs ---
  const stepsRef = useRef(steps);
  const idxRef = useRef(0);
  const minDistRef = useRef(null);
  const trendCountRef = useRef(0);
  const bearingOkCountRef = useRef(0);
  const lastStepIdxRef = useRef(-1);
   // step-bazlı konuşma kilitleri
   const preSpokenRef = useRef(new Set());
   const finalSpokenRef = useRef(new Set());
   const arrivedRef = useRef(false);
  // speech gate
  const lastSpeechAtRef = useRef(0);
  const speechHoldUntilRef = useRef(0);
  const kickstartedRef = useRef(false); // 🆕 step-1 okundu mu

  // constants
  const SPEECH_MIN_GAP_MS = 1200;
  const TAIL_SILENCE_MS = 500;


useEffect(() => {
  if (!location?.latitude) return;

  // henüz kickstart yapılmadıysa
  if (!kickstartedRef.current) {
    const s0 = stepsRef.current?.[0];
    if (s0) {
      // sadece yönlendirme oku
      const msg0 = formatInstructionTR?.(s0) ?? 'Başlayın';
      speak?.(msg0);

      kickstartedRef.current = true;
    }
  }

  // eğer step-0 ise ve kullanıcı hareket ettiyse step-1’e geç
  if (idxRef.current === 0 && kickstartedRef.current) {
    const dist0 = getStepDistanceValue?.(stepsRef.current[0]) ?? null;
    if (Number.isFinite(dist0) && dist0 > 0) {
      const remaining = getDistanceMeters?.(location, getManeuverTarget(stepsRef.current[0]));
      // ilerleme tespit: mesafe azaldı veya hız > 0
      if ((remaining !== null && remaining < dist0 - 5) || (location.speed ?? 0) > 0.5) {
        setCurrentStepIndex(1);
        idxRef.current = 1;
        minDistRef.current = null;
        trendCountRef.current = 0;
        bearingOkCountRef.current = 0;
      }
    }
  }
}, [location]);

  // adımlar değişince resetle
  useEffect(() => {
    stepsRef.current = Array.isArray(steps) ? steps : [];
    setCurrentStepIndex(0);
    idxRef.current = 0;
    setDistanceToManeuver(null);
    setLiveRemain({ dist: null, sec: null });
    minDistRef.current = null;
    trendCountRef.current = 0;
    bearingOkCountRef.current = 0;
    lastStepIdxRef.current = -1;
    lastSpeechAtRef.current = 0;
    speechHoldUntilRef.current = 0;
    preSpokenRef.current = new Set();
    finalSpokenRef.current = new Set();
    arrivedRef.current = false;
          kickstartedRef.current = false;
  }, [steps]);

   // sınıflayıcılar
   const isDepartish = (step) => {
     const t = (step?.maneuver?.type || '').toLowerCase();
     return t === 'depart' || t === 'continue' || t === 'straight';
   };
   const isRealManeuver = (step) => {
     const t = (step?.maneuver?.type || '').toLowerCase();
     return [
       'turn','fork','merge','roundabout','rotary','on_ramp','off_ramp','end_of_road','uturn'
     ].includes(t);
   };

  const sayQueued = useCallback((text, { delayMs = 0, minGapMs = SPEECH_MIN_GAP_MS } = {}) => {
    const now = Date.now();
    const wait = Math.max(
      delayMs,
      lastSpeechAtRef.current + minGapMs - now,
      speechHoldUntilRef.current - now,
      0
    );
    setTimeout(() => {
      lastSpeechAtRef.current = Date.now();
      // kaba bir süre tahmini (kelime ~350ms)
      const dur = Math.max(600, Math.min(3500, Math.round(text.split(/\s+/).length * 350)));
      speechHoldUntilRef.current = Date.now() + dur + TAIL_SILENCE_MS;
      try { speak?.(text); } catch {}
    }, wait);
  }, [speak]);

    // küçük yardımcılar
   // heading güvenilir mi? (hız + hedef yönle uyum)
   const relativeOk = useCallback((hEff, step, speed) => {
     if (!Number.isFinite(hEff)) return false;
     const sp = Number.isFinite(speed) ? speed : 0;
     // çok yavaşken pusula/sensör dalgalı olur → relative verme
     if (sp < 1.5) return false;
     const m = step?.maneuver || {};
     const bearingAfter = typeof m.bearing_after === 'number' ? m.bearing_after : null;
     if (!Number.isFinite(bearingAfter)) return false;
     // kullanıcı bakış yönü ile manevra sonrası yön yakınsa relative güvenli
     const diff = Math.abs(normalizeDeg180(bearingAfter - hEff));
     return diff <= 60; // 60° tolerans (ilk saniyelerdeki jitter'ı tolere eder)
   }, []);
 
   const pickDirective = useCallback((hEff, step, speed) => {
     const useRelative = relativeOk(hEff, step, speed);
     if (useRelative) {
       return formatInstructionRelativeTR?.(hEff, step) ?? formatInstructionTR?.(step);
     }
     return formatInstructionTR?.(step);
   }, [formatInstructionRelativeTR, formatInstructionTR, relativeOk]);

  const speakBanner = useCallback(() => {
    const s = stepsRef.current?.[idxRef.current];
    const msg = s
      ? formatInstructionRelativeTR?.(heading, s) ?? formatInstructionTR?.(s) ?? 'Navigasyon'
      : 'Navigasyon';
    try { speak?.(msg); } catch {}
  }, [heading, speak, formatInstructionRelativeTR, formatInstructionTR]);

  // konum değişiminde manevra/seviye akışı
  useEffect(() => {
    const loc = location;
    if (!loc?.latitude || !loc?.longitude) return;
  
     // 🟦 KICKSTART: ilk konum geldiğinde step-1'i oku, gerekiyorsa hemen step-2'ye geç
     if (!kickstartedRef.current) {
       kickstartedRef.current = true;
       const s0 = stepsRef.current?.[0];
       if (s0) {
         // 1) Banner’da kısa süre step-1 görünsün
         setBannerStep(s0);
         if (bannerHoldTimerRef.current) clearTimeout(bannerHoldTimerRef.current);
         bannerHoldTimerRef.current = setTimeout(() => setBannerStep(null), 1600);
 
         // 2) Step-1 cümlesini düz metinle (relative değil) hemen oku
         const msg0 = formatInstructionTR?.(s0) ?? 'Başla';
         try { speak?.(msg0); } catch {}
 
         // 3) Eğer step-1 bir ilerleme adımıysa ve kısa ise index=1'e atla
         const len0 = Number(getStepDistanceValue?.(s0) ?? 0);
         if (isDepartish(s0) && Number.isFinite(len0) && len0 > 0 && len0 <= 150) {
           setCurrentStepIndex(1);
           idxRef.current = 1;
           // min/trend reset
           minDistRef.current = null;
           trendCountRef.current = 0;
           bearingOkCountRef.current = 0;
         }
       }
     }
 
    const curSteps = stepsRef.current;
    const idx = Math.max(0, Math.min(idxRef.current, (curSteps?.length || 1) - 1));
    if (idx !== lastStepIdxRef.current) {
      lastStepIdxRef.current = idx;
      trendCountRef.current = 0;
      bearingOkCountRef.current = 0;
      minDistRef.current = null;
    }

     // --- aktif adım: Banner = currentStepIndex ---
     let step = curSteps?.[idx];
     // Eğer bu adım "depart/continue" ise ve ileriye yakın bir GERÇEK manevra varsa,
     // kullanıcıyı bekletmeyelim; hemen o manevraya atla (banner ve ses ona kilitlensin).
     const next = curSteps?.[idx + 1];
     if (step && isDepartish(step) && next && isRealManeuver(next)) {
       // kullanıcı hareket ettiyse veya manevra yakınsa (pre eşiği kadar)
       const user = { lat: loc.latitude, lng: loc.longitude };
       const targetNext = getManeuverTarget?.(next);
       const dToNext = targetNext ? getDistanceMeters?.(user, targetNext) : null;
       const speed = Number.isFinite(loc.speed) ? loc.speed : 0;
       const { pre } = getTwoStageThresholds?.(next, speed) || { pre: 120 };
       if ((Number.isFinite(dToNext) && dToNext <= pre + 30) || speed > 0.5) {
         const newIdx = idx + 1;
         setCurrentStepIndex(newIdx);
         idxRef.current = newIdx;
         minDistRef.current = null;
         trendCountRef.current = 0;
         bearingOkCountRef.current = 0;
         step = curSteps?.[newIdx];
       }
     }
    const target = step ? getManeuverTarget?.(step) : null;

    const user = { lat: loc.latitude, lng: loc.longitude };
    const speed = Number.isFinite(loc.speed) ? loc.speed : null;
    const sensorHeading = Number.isFinite(loc.heading) ? loc.heading : null;

    if (step && target) {
      const dist = getDistanceMeters?.(user, target);
      if (Number.isFinite(dist)) {
        setDistanceToManeuver(dist);

        // kalan mesafe/süre
        const dyn = calcRemaining?.(curSteps, idx, dist);
        if (dyn) setLiveRemain({ dist: dyn.dist ?? null, sec: dyn.sec ?? null });

        // min mesafe takip
        if (minDistRef.current == null || dist < minDistRef.current) {
          minDistRef.current = dist;
        }

        // iki aşamalı eşikler
        const { pre, final } = getTwoStageThresholds?.(step, speed) || { pre: 100, final: 20 };
        const hEff = Number.isFinite(sensorHeading) ? sensorHeading : heading;

        // pre anons (tek atım, güvenli relative)
        if (dist <= pre && dist > final + 8 && !preSpokenRef.current.has(idx)) {
          const directive = pickDirective(hEff, step, speed);
          sayQueued(`Yaklaşık ${formatMeters(pre)} sonra ${directive}.`, { minGapMs: 1200 });
          preSpokenRef.current.add(idx);
        }

         // final anons + haptik (yalnızca 1 kez)
         if (dist <= final && dist > Math.max(6, final - 12) && !finalSpokenRef.current.has(idx)) {
          try { buzz?.(); } catch {}
           const rel = relativeOk(hEff, step, speed);
           const directiveShort = rel
             ? (shortDirectiveTR?.(hEff, step) ?? formatInstructionTR?.(step))
             : (formatInstructionTR?.(step));          sayQueued(`Şimdi ${directiveShort}.`, { delayMs: 700, minGapMs: 1500 });
          finalSpokenRef.current.add(idx);
        }

        // geçiş kapıları
        const passedByTrend =
          minDistRef.current != null && dist > minDistRef.current + 8 && minDistRef.current < 45;

        const m = step?.maneuver || {};
        const bearingOK =
          typeof m.bearing_after === 'number' && Number.isFinite(hEff)
            ? Math.abs(normalizeDeg180(m.bearing_after - hEff)) < 30
            : false;
        const speedOk = (Number.isFinite(speed) ? speed : 0) > 1.5;

        if (passedByTrend) trendCountRef.current += 1; else trendCountRef.current = 0;
        if (bearingOK && dist < 30 && speedOk) bearingOkCountRef.current += 1; else bearingOkCountRef.current = 0;

        const closeEnough = dist <= completionThreshold(step, getStepDistanceValue);

        if (closeEnough || trendCountRef.current >= 2 || bearingOkCountRef.current >= 2) {
          // son adımdaysa varış
           if (idx >= (curSteps?.length || 1) - 1) {
             if (!arrivedRef.current) {
               arrivedRef.current = true;
               try { onArrive?.(); } catch {}
             }
             return;
           }

          // bir sonraki adıma geç
          const nextIndex = idx + 1;
          setCurrentStepIndex(nextIndex);
          idxRef.current = nextIndex;

          // reset kapılar
          minDistRef.current = null;
          trendCountRef.current = 0;
          bearingOkCountRef.current = 0;

          // “bir sonraki” direktifi
          const next = curSteps?.[nextIndex];
          const h2 = Number.isFinite(heading) ? heading : hEff;
          const msg = pickDirective(h2, next, speed);
          sayQueued(msg, { delayMs: 800, minGapMs: 2000 });

          // yeni hedefe göre ilk distance tahmini
          const nxtTarget = next ? getManeuverTarget?.(next) : null;
          if (nxtTarget) {
            const d2 = getDistanceMeters?.(user, nxtTarget);
            if (Number.isFinite(d2)) setDistanceToManeuver(d2);
          } else {
            // step distance fallback
            const dEst = next ? getStepDistanceValue?.(next) : null;
            if (Number.isFinite(dEst)) setDistanceToManeuver(dEst);
          }
        }
      }
    } else {
      // step yoksa: polyline'a mesafe (fallback)
      const coords = routeCoordsRef?.current;
      if (Array.isArray(coords) && coords.length >= 2 && typeof getDistanceMeters === 'function') {
        // en yakın segment tahmini için kaba bir “en yakın nokta” yerine
        // kullanıcıya en yakın polyline köşesine mesafe tahmini kullan
        let best = Infinity;
        for (let i = 0; i < coords.length; i++) {
          const p = { lat: coords[i][1], lng: coords[i][0] };
          const d = getDistanceMeters(user, p);
          if (Number.isFinite(d) && d < best) best = d;
          if (best < 5) break;
        }
        if (Number.isFinite(best)) setDistanceToManeuver(best);
        setLiveRemain({ dist: best, sec: Number.isFinite(best) ? Math.round(best / 12.5) : null });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, heading, onArrive]);

  // public API
  return {
    currentStepIndex,
    setCurrentStepIndex,
    distanceToManeuver,
    liveRemain,
    speakBanner,
    bannerStep,
  };
}

/* ----------------------- küçük yardımcılar ----------------------- */

function normalizeDeg180(deg) {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

function completionThreshold(step, getStepDistanceValue) {
  const stepLen = getStepDistanceValue?.(step) ?? 80;
  return Math.round(Math.min(28, Math.max(12, stepLen * 0.25)));
}

function formatMeters(m) {
  if (m == null || Number.isNaN(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 2000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(1, Math.round(m))} m`;
}
