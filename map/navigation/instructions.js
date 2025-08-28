// src/navigation/helpers/instructions.js
import { decodePolyline } from '../maps';

// Küçük yardımcılar
export const clamp = (min, max, v) => Math.min(max, Math.max(min, v));

export const normalizeDeg180 = (deg) => {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

// Adım/mesafe/süre değer çözücüleri
export const getStepDistanceValue = (step) => {
  if (!step) return null;
  if (typeof step.distance === 'number') return step.distance;
  if (typeof step.distance?.value === 'number') return step.distance.value;
  return null;
};
export const getStepDurationValue = (step) => {
  if (!step) return null;
  if (typeof step.duration === 'number') return step.duration;
  if (typeof step.duration?.value === 'number') return step.duration.value;
  return null;
};

// Manevra hedefi
export const getManeuverTarget = (step) => {
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
  if (!pl) return null;
  try {
    const pts = decodePolyline(pl);
    const last = pts?.[pts.length - 1];
    if (!last) return null;
    return { lat: last.latitude ?? last.lat, lng: last.longitude ?? last.lng };
  } catch {
    return null;
  }
};

// TR talimat metinleri
export const formatInstructionTR = (step) => {
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

export const formatInstructionRelativeTR = (headingDeg, step) => {
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

export const getTwoStageThresholds = (step, speedMps) => {
  const len = getStepDistanceValue(step) ?? 120;
  const pre = clamp(80, 140, len >= 220 ? 120 : 100);
  const v = Number.isFinite(speedMps) ? speedMps : 8;
  const timeBased = v * 3;
  const final = clamp(12, 35, Math.max(15, Math.min(35, timeBased)));
  return { pre, final };
};

export const shortDirectiveTR = (headingDeg, step) => {
  const t = formatInstructionRelativeTR(headingDeg, step) || '';
  return t.replace(/^birazdan\s+/i, '').replace(/^düz devam edin$/i, 'düz devam edin');
};

// Kalan mesafe/süre hesabı
export const calcRemaining = (stepsArr, idx, distToMan) => {
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
