// trips/services/mealSuggest.js
// Öğün boşluklarını doldur: önce kullanıcının seçtiklerinden uygun olanı,
// yoksa google fallback ile yakında yüksek puanlı 'suggestion' ekle

import { poiSearch } from '../../app/lib/api';

function toMinutes(hhmm) {
  const [h, m] = (hhmm || '13:00').split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function suggestMealsForGaps(day, { prefs, selectedPlaces, city }) {
  const lunchT = toMinutes(prefs?.lunchAround || '13:00');
  const dinnerT = toMinutes(prefs?.dinnerAround || '19:00');

  const hasLunch = day.activities.some(a => a.type === 'meal' && minAt(a.start) <= lunchT && minAt(a.end) >= lunchT);
  const hasDinner = day.activities.some(a => a.type === 'meal' && minAt(a.start) <= dinnerT && minAt(a.end) >= dinnerT);

  let activities = [...day.activities];

  // Yardımcı: Yakındaki uygun POI'yi bul (önce kullanıcı seçtikleri, sonra Google)
  const findMealNear = async (aroundIdx) => {
    const anchor = activities[aroundIdx]?.place?.location || null;
    if (!anchor) return null;

    const candidatesUser = (selectedPlaces || [])
      .filter(p => ['restaurants', 'bars', 'cafes'].includes(p.category))
      .map(p => ({ ...p, dist: distMeters(anchor, p.location) }))
      .filter(p => p.dist <= (prefs?.mealSearchRadiusMeters || 1200))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));

    if (candidatesUser.length) {
      const top = candidatesUser[0];
      return {
        type: 'meal',
        label: 'suggestion',
        suggestion: true,
        place: top,
        durationMin: 60,
      };
    }

    // Google fallback
    try {
      // Şehir varsa text search'e katkı olur
      const q = 'restaurant'; // generic
      const res = await poiSearch(q, {
        lat: anchor.lat,
        lon: anchor.lon,
        city: city || '',
        category: 'restaurants',
      });
      const list = Array.isArray(res?.items) ? res.items : [];
      const filtered = list
        .filter(it => (it.rating || 0) >= (prefs?.minRating || 4.2))
        .slice(0, 1); // en iyiyi al
      if (filtered.length) {
        const it = filtered[0];
        const place = {
          id: it.id || it.place_id || `${it.lat},${it.lon}`,
          name: it.name,
          category: it.category || 'restaurants',
          rating: it.rating || 0,
          address: it.address,
          location: { lat: it.lat, lon: it.lon },
        };
        return {
          type: 'meal',
          label: 'suggestion',
          suggestion: true,
          place,
          durationMin: 60,
        };
      }
    } catch (e) {
      console.warn('[mealSuggest] google fallback error', e);
    }
    return null;
  };

  // Lunch ekle
  if (!hasLunch && activities.length >= 1) {
    const idx = nearestActivityIndex(activities, lunchT);
    const meal = await findMealNear(idx);
    if (meal) {
      const insertAt = Math.min(idx + 1, activities.length);
      activities.splice(insertAt, 0, materializeMealBlock(meal, lunchT));
    }
  }

  // Dinner ekle
  if (!hasDinner && activities.length >= 1) {
    const idx = nearestActivityIndex(activities, dinnerT);
    const meal = await findMealNear(idx);
    if (meal) {
      const insertAt = Math.min(idx + 1, activities.length);
      activities.splice(insertAt, 0, materializeMealBlock(meal, dinnerT));
    }
  }

  return { ...day, activities };
}

function minAt(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function midOf(a) {
  const s = minAt(a.start || '00:00');
  const e = minAt(a.end || '00:00');
  return Math.round((s + e) / 2);
}
function nearestActivityIndex(list, targetMin) {
  let best = 0, bd = Infinity;
  list.forEach((a, i) => {
    const m = midOf(a);
    const d = Math.abs(m - targetMin);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function distMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s1 = Math.sin(dLat / 2) ** 2 +
             Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1)) * R / R; // sade: haversine → metre
}

function rand() { return Math.random().toString(36).slice(2, 8); }
function makeMealId(place, targetMin, type = 'meal') {
  const base = place?.id || `${place?.location?.lat},${place?.location?.lon}`;
  return `${type}:${base}:${targetMin}:${rand()}`;
}

function materializeMealBlock(meal, targetMin) {
  const dur = meal.durationMin || 60;
  const start = targetMin - Math.floor(dur / 2);
  const end = start + dur;
  return {
    id: meal.id || makeMealId(meal.place, targetMin, meal.type || 'meal'),
    ...meal,    start: fromMinutes(Math.max(start, 10)),
    end: fromMinutes(Math.max(end, start + 30)),
    meta: { suggestion: true },
  };
}
