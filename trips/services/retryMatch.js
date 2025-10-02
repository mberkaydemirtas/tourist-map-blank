// trips/services/retryMatch.js
import { resolvePlacesBatch } from './placeResolver';

// Trip içindeki “eşleşmemiş” yerleri bulup batch resolve eder.
// returns: { updatedPlaces, resolvedCount }
export async function retryResolveTripPlaces(trip, { city = '' } = {}) {
  // 1) Kaynak: trip.selectedPlaces varsa onu, yoksa trip.places
  const items = Array.isArray(trip?.selectedPlaces) && trip.selectedPlaces.length
    ? trip.selectedPlaces
    : (Array.isArray(trip?.places) ? trip.places : []);

  if (!items.length) return { updatedPlaces: items, resolvedCount: 0 };

  // 2) Eşleşmemişleri filtrele (İŞTE BURASI: 'toResolve' TANIMLI)
  const toResolve = items.filter(p => !p.place_id && (p.lat != null || p?.coords?.lat != null));

  if (!toResolve.length) return { updatedPlaces: items, resolvedCount: 0 };

  // 3) Batch resolve
  const resolved = await resolvePlacesBatch({ items: toResolve, city });

  // 4) Sonuçları orijinal listeye geri yaz
  const byKey = new Map(
    resolved.map(r => {
      const key = r.id || r.osm_id || `${r.name}@${r?.coords?.lat},${r?.coords?.lng}`;
      return [key, r];
    })
  );

  let resolvedCount = 0;
  const updated = items.map(p => {
    if (p.place_id) return p; // zaten eşleşmiş
    const key = p.id || p.osm_id || `${p.name}@${p?.lat ?? p?.coords?.lat},${p?.lon ?? p?.coords?.lng}`;
    const m = byKey.get(key);
    if (m?.place_id) {
      resolvedCount++;
      return {
        ...p,
        place_id: m.place_id,
        opening_hours: m.opening_hours ?? p.opening_hours ?? null,
        rating: m.rating ?? p.rating ?? null,
        user_ratings_total: m.user_ratings_total ?? p.user_ratings_total ?? null,
        price_level: m.price_level ?? p.price_level ?? null,
        // koordinat normalize:
        lat: m?.coords?.lat ?? m?.lat ?? p.lat ?? p?.coords?.lat,
        lon: m?.coords?.lng ?? m?.lon ?? p.lon ?? p?.coords?.lng,
        coords: m?.coords ? m.coords : (p.coords || null),
      };
    }
    return p;
  });

  return { updatedPlaces: updated, resolvedCount };
}
