// trips/shared/anchors.js

/** Tarihi 'YYYY-MM-DD' normalize eder */
function normalizeDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/** trip.lodgings → { [YYYY-MM-DD]: { location:{lat,lon} } } */
export function mapLodgingsByDate(trip) {
  const out = {};
  for (const l of Array.isArray(trip?.lodgings) ? trip.lodgings : []) {
    const dRaw = l?.date || l?.checkIn || l?.check_in || l?.checkInDate || l?.start;
    const d = normalizeDate(dRaw);
    if (!d) continue;

    const lat = Number(l?.location?.lat ?? l?.coords?.lat ?? l?.lat);
    const lon = Number(
      l?.location?.lng ?? l?.location?.lon ?? l?.coords?.lng ??
      l?.coords?.lon ?? l?.lng ?? l?.lon
    );

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      out[d] = { location: { lat, lon } };
    }
  }
  return out;
}

/**
 * UI + optimizer için o günün sabit noktalarını çıkarır.
 * @returns {
 *   start: {lat,lon}|null,
 *   end:   {lat,lon}|null,
 *   lodge: {lat,lon}|null,
 *   startLabel: string,
 *   endLabel:   string
 * }
 */
export function getAnchorsForDayDetailed(trip, day) {
  const wa = trip?._whereAnswer;
  const seSingle = trip?._startEndSingle || null;
  const byDate = mapLodgingsByDate(trip);

  const dayISO = day?.date;
  if (!dayISO) {
    return {
      start: null,
      end: null,
      lodge: null,
      startLabel: 'Başlangıç',
      endLabel: 'Bitiş',
    };
  }

  const lodge = byDate[dayISO]?.location || null;
  let start = lodge || null;
  let end = lodge || null;
  let startLabel = lodge ? 'Başlangıç (Konaklama)' : 'Başlangıç';
  let endLabel   = lodge ? 'Bitiş (Konaklama)'     : 'Bitiş';

  if (wa?.mode === 'single' && seSingle) {
    const isStartDay = seSingle?.start?.date === dayISO;
    const isEndDay   = seSingle?.end?.date === dayISO;

    const hubLoc = (p) =>
      p?.hub?.location
        ? { lat: p.hub.location.lat, lon: p.hub.location.lng }
        : null;

    if (isStartDay) {
      const hub = hubLoc(seSingle.start);
      start = hub || lodge || null;
      startLabel = hub ? 'Başlangıç (Hub)' : (lodge ? 'Başlangıç (Konaklama)' : 'Başlangıç');
    }

    if (isEndDay) {
      const hub = hubLoc(seSingle.end);
      end = hub || lodge || null;
      endLabel = hub ? 'Bitiş (Hub)' : (lodge ? 'Bitiş (Konaklama)' : 'Bitiş');
    }
  }

  return { start, end, lodge, startLabel, endLabel };
}
