// trips/utils/placeUtils.js
import Constants from 'expo-constants';

const API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

export function isStrictPlaceId(pid) {
  if (typeof pid !== 'string') return false;
  return /^(ChIJ|Gh)[A-Za-z0-9_-]{8,}$/.test(pid);
}

function _cleanTitle(s) {
  if (!s) return '';
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/[|•–—\-]+/g, '–')
    .replace(/^[\s–,.;:]+|[\s–,.;:]+$/g, '')
    .trim();
}

function _isGenericTitle(s, idx1) {
  if (!s) return true;
  const x = s.toLowerCase();
  if (/^durak\s*\d+$/i.test(x)) return true;
  if (x === 'durak' || x === 'nokta') return true;
  if (x === 'seçilen yer' || x === 'seçilen konum') return true;
  if (/^(durak\s*\d+)\s*[–-]\s*\1$/i.test(x)) return true;
  if (/^isimsiz|^unnamed|^unknown/.test(x)) return true;
  if (/^[\d\s→\-–]+$/.test(x)) return true;
  if (idx1 && x === `durak ${idx1}`) return true;
  return false;
}

function _shortAddress(addr) {
  const s = _cleanTitle(addr);
  const first = s.split(',')[0]?.trim();
  return first?.length >= 3 ? first : s || '';
}

function _dedupeSegments(s) {
  const parts = s.split(/[\s–|]+/).filter(Boolean);
  const uniq = [];
  for (const p of parts) {
    if (!uniq.some(u => u.toLowerCase() === p.toLowerCase())) uniq.push(p);
  }
  return uniq.join(' – ');
}

export function getActName(a, idx) {
  const idx1 = Number.isFinite(idx) ? idx + 1 : null;
  const candsRaw = [
    a?.place?.name,
    a?.place?.displayName,
    a?.label,
    a?.title,
    a?.place?.formatted_address,
    a?.place?.address,
  ];
  const cands = candsRaw.map(_cleanTitle).filter(Boolean);
  let best = cands.find(t => !_isGenericTitle(t, idx1));
  if (!best) {
    const addr = a?.place?.formatted_address || a?.place?.address || '';
    const short = _shortAddress(addr);
    if (short && !_isGenericTitle(short, idx1)) best = short;
  }
  if (!best) best = idx1 ? `Durak ${idx1}` : 'Durak';
  best = _dedupeSegments(best);
  return best;
}

export function extractPhotoUrlsFromActivity(a) {
  const out = [];
  const pushAny = (v) => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object') {
      if (v.url) out.push(v.url);
      else if (v.uri) out.push(v.uri);
      else if (v.photoUrl) out.push(v.photoUrl);
      else if (v.src) out.push(v.src);
      else if (v.photo_reference) out.push(v.photo_reference);
    }
  };
  if (Array.isArray(a?.place?.photos)) a.place.photos.forEach(pushAny);
  pushAny(a?.place?.coverPhoto);
  pushAny(a?.place?.photoUrl);
  pushAny(a?.meta?.photoUrl);
  pushAny(a?.icon);
  return out.filter(Boolean);
}

export function buildGooglePhotoUrl(photoRef, apiKey = API_KEY, { maxwidth = 800 } = {}) {
  if (!photoRef || !apiKey) return null;
  const base = 'https://maps.googleapis.com/maps/api/place/photo';
  const p = new URLSearchParams({ photoreference: String(photoRef), maxwidth: String(maxwidth), key: String(apiKey) });
  return `${base}?${p.toString()}`;
}

export function coercePhotoInputsToUrls(list, apiKey = API_KEY, { maxwidth = 800 } = {}) {
  const out = [];
  for (const v of list || []) {
    if (!v) continue;
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v)) out.push(v);
      else if (/^[A-Za-z0-9_-]{20,}$/.test(v)) {
        const u = buildGooglePhotoUrl(v, apiKey, { maxwidth });
        if (u) out.push(u);
      } else if (/place\/photo/i.test(v) && !/(\?|&)key=/.test(v) && apiKey) {
        const sep = v.includes('?') ? '&' : '?';
        out.push(`${v}${sep}key=${apiKey}`);
      }
    } else if (typeof v === 'object') {
      const url = v.url || v.uri || v.src || v.photoUrl;
      if (url && /^https?:\/\//i.test(url)) out.push(url);
      else if (v.photo_reference) {
        const u = buildGooglePhotoUrl(v.photo_reference, apiKey, { maxwidth });
        if (u) out.push(u);
      }
    }
  }
  return Array.from(new Set(out));
}

export function extractPossiblePlaceIdFromActivity(a) {
  const candidates = [
    a?.place?.place_id,
    a?.meta?.place_id,
    a?.gPlaceId,
    a?.place?.gPlaceId,
    a?.place?.id,
  ].filter(Boolean);
  return candidates.find(isStrictPlaceId) || null;
}
