import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { getPlaceDetails } from '../../services/placeService';
import { normalizeCoord } from '../utils/coords';

export function usePlacesLogic() {
  const [marker, setMarker] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [query, setQuery] = useState('');

  const fetchAndSetMarker = useCallback(
    async (placeId, fallbackCoord, fallbackName = '') => {
      setIsLoadingDetails(true);
      try {
        const details = await getPlaceDetails(placeId);
        if (!details) {
          console.warn('⚠️ Marker detayları boş geldi:', placeId);
          return null;
        }

        const coord = normalizeCoord(fallbackCoord || details.coords || details.geometry?.location);
        const photos  = details.photos  || [];
        const reviews = details.reviews || [];
        const types   = details.types   || [];

        let resolvedName = details.name?.trim() && details.name.length > 3
          ? details.name
          : fallbackName || details.address || types[0]?.replace(/_/g, ' ') || 'Yer Bilgisi';

        setMarker({
          name: resolvedName,
          address: details.address,
          coordinate: coord,
          rating: details.rating ?? null,
          priceLevel: details.priceLevel ?? null,
          googleSearchUrl: details.googleSearchUrl,
          openNow: details.openNow,
          hoursToday: details.hoursToday,
          phone: details.phone,
          website: details.website,
          photos,
          reviews,
          types,
        });
        setQuery(resolvedName || details.address);

        return coord;
      } catch (e) {
        Alert.alert('Hata', 'Yer detayları alınamadı.');
        console.warn('🛑 Marker detayları alınırken hata:', e);
        return null;
      } finally {
        setIsLoadingDetails(false);
      }
    },
    []
  );

  return {
    marker, setMarker,
    isLoadingDetails,
    query, setQuery,
    fetchAndSetMarker,
  };
}