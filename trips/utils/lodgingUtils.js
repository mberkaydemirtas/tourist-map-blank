// trips/utils/lodgingUtils.js
import { deriveDateRange, nightsBetween, sanitizeIsoDate, toISODateSafe } from './tripDateUtils';

export const mapLodgingsByDateWithFallback = (trip) => {
  const { start, end } = deriveDateRange(trip);
  const nights = nightsBetween(start, end);
  const byDate = Object.create(null);

  for (const it of (trip?.lodgings || [])) {
    const d = sanitizeIsoDate(it?.date);
    const loc = it?.location;
    if (!d || !loc) continue;
    byDate[d] = {
      name: it?.name || 'Lodging',
      lat:  Number(loc.lat),
      lon:  Number(loc.lon ?? loc.lng),
    };
  }

  const seg = (trip?._lodgingSingle || [])[0];
  const segLoc = seg?.place?.location || seg?.place?.place?.location || null;
  const segName = seg?.place?.name || seg?.place?.place?.name || null;
  if (segLoc) {
    for (const d of nights) {
      if (!byDate[d]) {
        byDate[d] = {
          name: segName || 'Lodging',
          lat: Number(segLoc.lat),
          lon: Number(segLoc.lon ?? segLoc.lng),
        };
      }
    }
  }
  const lodgingsCount = nights.filter(d => !!byDate[d]).length;
  return { byDate, lodgingsCount, range:{start,end} };
};

export const deriveLodgeFromTrip = (trip, day) => {
  if (!trip || !day) return null;
  const { byDate } = mapLodgingsByDateWithFallback(trip);
  const d = toISODateSafe(day.date);
  const hit = byDate[d];
  return hit || null;
};
