// src/services/hotelSuggest.js
// Şehir merkezine göre en iyi otelleri döndürür (Google Places Nearby Search tabanlı).
// Geri dönüş: [{ name, place_id, rating, user_ratings_total, address, location:{lat,lng}, photoRef? }]

import { getNearbyPlaces } from '../../../map/maps'; // projendeki services/maps.js içinden

/**
 * @param {{lat:number,lng:number}} center - Şehir merkezi (WhereToQuestion’dan geliyor)
 * @param {number} limit - Kaç adet (10,15,20)
 * @param {number} radiusMeters - Arama yarıçapı (varsayılan 8000 m)
 */
export async function getTopLodgingsByCity(center, limit = 10, radiusMeters = 8000) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return [];

  // maps.getNearbyPlaces(region,type) interface’ini şehir merkezine uyarlayalım
  // region: { latitude, longitude, latitudeDelta, longitudeDelta } bekliyor olabilir;
  // çoğu implementasyonda sadece center’ı kullanıyoruz. Güvenli tarafta kalalım:
  const region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.2,
    longitudeDelta: 0.2,
    // Bazı implementasyonlarda radius paramını options’tan geçiriyoruz:
    radius: radiusMeters,
  };

  // type=lodging → oteller, pansiyonlar, vb.
  const raw = await getNearbyPlaces(region, 'lodging').catch(() => []);
  const list = Array.isArray(raw) ? raw : [];

  // Beklenen alanlar: name, place_id, rating, user_ratings_total, vicinity/formatted_address, geometry.location, photos[0].photo_reference?
  // Sıralama: önce rating (desc), sonra user_ratings_total (desc)
  const scored = list
    .map(p => ({
      name: p.name || '',
      place_id: p.place_id || p.id || null,
      rating: Number(p.rating ?? 0),
      user_ratings_total: Number(p.user_ratings_total ?? 0),
      address: p.vicinity || p.formatted_address || '',
      location: {
        lat: p.geometry?.location?.lat ?? p.location?.lat ?? p.coords?.latitude ?? null,
        lng: p.geometry?.location?.lng ?? p.location?.lng ?? p.coords?.longitude ?? null,
      },
      photoRef: Array.isArray(p.photos) && p.photos[0]?.photo_reference ? p.photos[0].photo_reference : null,
    }))
    .filter(h => h.place_id && Number.isFinite(h.location.lat) && Number.isFinite(h.location.lng));

  scored.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
  });

  return scored.slice(0, limit);
}
