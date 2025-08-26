// src/navigation/useNavSim.js
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Rota simülatörü — timer ile rota üzerinde ilerler, her tick'te
 * {lat,lng,heading,speed} verir. onTick ref ile tutulur (stable).
 */
export default function useNavSim({
  routeCoordinates,
  metersBetween,
  onTick,
  tickMs = 500,
}) {
  const [simActive, setSimActive] = useState(false);
  const [simSpeedKmh, setSimSpeedKmh] = useState(30);
  const [simCoord, setSimCoord] = useState(null); // {lat,lng}

  const timerRef = useRef(null);
  const stateRef = useRef({ i: 0, t: 0 }); // segment index + [0..1]
  const onTickRef = useRef(onTick);

  // 🔧 onTick’i ref’te güncel tut, fakat effect bağımlılığı yapma
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);

  // Rota → {lat,lng} normalizasyonu (stable)
  const path = useMemo(() => {
    const out = [];
    const src = Array.isArray(routeCoordinates) ? routeCoordinates : [];
    for (const c of src) {
      if (Array.isArray(c) && c.length >= 2) {
        const lat = Number(c[1]), lng = Number(c[0]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
      } else if (c && typeof c === 'object') {
        const lat = Number(c.latitude ?? c.lat);
        const lng = Number(c.longitude ?? c.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
      }
    }
    return out;
  }, [routeCoordinates]);

  const bearingDeg = (A, B) => {
    const toRad = (x) => (x * Math.PI) / 180;
    const φ1 = toRad(A.lat), φ2 = toRad(B.lat);
    const λ1 = toRad(A.lng), λ2 = toRad(B.lng);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    const θ = Math.atan2(y, x);
    return ((θ * 180) / Math.PI + 360) % 360;
  };

  useEffect(() => {
    // kapat/temizle
    if (!simActive) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (!path || path.length < 2) return;

    // rota değişmiş olabilir → mevcut state’i koru (i,t)
    const v = Math.max(1, Number(simSpeedKmh)) * 1000 / 3600; // m/s

    const stepOnce = () => {
      let advance = v * (tickMs / 1000);
      let s = stateRef.current;

      while (advance > 0 && s.i < path.length - 1) {
        const A = path[s.i], B = path[s.i + 1];
        const L = Math.max(1, metersBetween(A, B));
        const remain = L * (1 - s.t);
        if (advance < remain) {
          s = { ...s, t: s.t + advance / L };
          advance = 0;
        } else {
          advance -= remain;
          s = { i: Math.min(s.i + 1, path.length - 1), t: 0 };
        }
      }

      const A = path[s.i];
      const B = path[Math.min(s.i + 1, path.length - 1)];
      const t = s.t;
      const lat = A.lat + (B.lat - A.lat) * t;
      const lng = A.lng + (B.lng - A.lng) * t;
      const hdg = bearingDeg(A, B);

      stateRef.current = s;
      setSimCoord({ lat, lng });

      // ❗️ her render’da değişse bile ref sabit → effect reset olmaz
      try { onTickRef.current?.({ lat, lng, heading: hdg, speed: v }); } catch {}
    };

    // İlk frame’i hemen atmak istersen bu satırı açık bırak:
    stepOnce();
    timerRef.current = setInterval(stepOnce, tickMs);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  // ❗️ onTick dependency YOK; sadece stabil değerler
  }, [simActive, simSpeedKmh, path, metersBetween, tickMs]);

  // Unmount temizliği
  useEffect(() => () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  return {
    simActive, setSimActive,
    simSpeedKmh, setSimSpeedKmh,
    simCoord,
  };
}
