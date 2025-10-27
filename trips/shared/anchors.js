// shared/anchors.js

export function iso(d) {
  // YYYY-MM-DD pattern’ini yakala; bozuk tarihleri (ör. 20025-10-29) eleyip null döndür.
  const m = String(d || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

export function sameCoord(a, b) {
  if (!a || !b) return false;
  const alon = a.lon ?? a.lng; const blon = b.lon ?? b.lng;
  return a.lat === b.lat && alon === blon;
}

/** Lodging’leri { [YYYY-MM-DD]: { location, label? } } şekline getirir */
function lodgingsByDate(trip) {
  const out = {};
  for (const l of Array.isArray(trip?.lodgings) ? trip.lodgings : []) {
    const d = iso(l?.date || l?.checkIn || l?.check_in || l?.checkInDate || l?.start);
    if (!d) continue;
    const lat = Number(l?.location?.lat ?? l?.coords?.lat ?? l?.lat);
    const lng = Number(l?.location?.lng ?? l?.location?.lon ?? l?.coords?.lng ?? l?.coords?.lon ?? l?.lng ?? l?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out[d] = { location: { lat, lon: lng }, label: l?.name || l?.label || l?.title || 'Konaklama' };
    }
  }
  return out;
}

/** Wizard’ın start/end verisi (single mod) */
function startEndSingle(trip) {
  const se = trip?._startEndSingle || {};
  const get = (pt) => {
    const d = iso(pt?.date);
    const hub = pt?.hub;
    const lat = Number(hub?.location?.lat);
    const lng = Number(hub?.location?.lng ?? hub?.location?.lon);
    return (d && Number.isFinite(lat) && Number.isFinite(lng))
      ? { date: d, label: hub?.name || (pt?.type === 'airport' ? 'Havaalanı' : 'Başlangıç/Bitiş'), location: { lat, lon: lng } }
      : null;
  };
  return { start: get(se.start), end: get(se.end) };
}

/** Tek şehir değilse (multi) -> _startEndByCity[k] ile benzer şekilde çekilir (opsiyonel) */
function startEndMultiByDate(trip) {
  const wa = trip?._whereAnswer;
  if (!wa || wa.mode === 'single') return {};
  const out = {};
  const byCity = trip?._startEndByCity || {};
  (wa.items || []).forEach(it => {
    const k = it?.city?.place_id;
    const se = byCity[k] || {};
    const put = (pt, kind) => {
      const d = iso(pt?.date); const hub = pt?.hub;
      const lat = Number(hub?.location?.lat);
      const lng = Number(hub?.location?.lng ?? hub?.location?.lon);
      if (!d || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      out[d] = out[d] || {};
      out[d][kind] = { date: d, label: hub?.name || (kind === 'start' ? 'Başlangıç' : 'Bitiş'), location: { lat, lon: lng } };
    };
    if (se?.start) put(se.start, 'start');
    if (se?.end)   put(se.end,   'end');
  });
  return out;
}

/** 🔑 Ana seçici: Gün için start/end/lodge verir */
export function getAnchorsForDayDetailed(trip, day) {
  const dayISO = iso(day?.date);
  const lodg = lodgingsByDate(trip);
  const single = startEndSingle(trip);
  const multiByDate = startEndMultiByDate(trip);

  // start/end: önce multi (güne özel), sonra single’a bak
  let start = multiByDate[dayISO]?.start?.location ?? (single.start?.date === dayISO ? single.start.location : null);
  let end   = multiByDate[dayISO]?.end?.location   ?? (single.end?.date   === dayISO ? single.end.location   : null);

  // lodging: trip.lodgings’ten
  const lodge = lodg[dayISO]?.location || null;

  // etiketler
  const startLabel = multiByDate[dayISO]?.start?.label || (single.start?.date === dayISO ? (single.start?.label || 'Başlangıç') : 'Başlangıç');
  const endLabel   = multiByDate[dayISO]?.end?.label   || (single.end?.date   === dayISO ? (single.end?.label   || 'Bitiş')    : 'Bitiş');

  // fallback: start/end yoksa konaklama koordinatını day anchor olarak kullan
  if (!start && lodge) start = lodge;
  if (!end && lodge)   end   = lodge;

  return { start, end, lodge, startLabel, endLabel };
}
