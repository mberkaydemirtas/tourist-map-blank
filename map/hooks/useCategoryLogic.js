import { useRef, useState } from 'react';
import { getNearbyPlaces } from '../../services/placeService';

/**
 * Kategori araması ve "Bu Bölgeyi Tara" akışı.
 * Not: Bölge/harita kontrolü (region, setRegion, mapRef) fonksiyonlara parametre olarak verilir.
 */
export function useCategoryLogic() {
  const [activeCategory, setActiveCategory] = useState(null);
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [mapMoved, setMapMoved] = useState(false);
  const lastPlacesKey = useRef(null);

  async function loadCategory(type, { mapRef, region, setRegion }) {
    setLoadingCategory(true);
    try {
      let center = region;
      if (mapRef?.current?.getCamera) {
        const camera = await mapRef.current.getCamera();
        center = {
          latitude: camera.center.latitude,
          longitude: camera.center.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(center);
      }

      const rawPlaces = await getNearbyPlaces(center, type);
      const places = rawPlaces
        .map((item) => {
          const lat =
            item.coords?.latitude ??
            item.coordinate?.latitude ??
            item.geometry?.location?.lat;
          const lng =
            item.coords?.longitude ??
            item.coordinate?.longitude ??
            item.geometry?.location?.lng;
          if (lat == null || lng == null) return null;
          return { ...item, coordinate: { latitude: lat, longitude: lng } };
        })
        .filter(Boolean);

      const key = JSON.stringify(places.map((p) => p.place_id || p.id || p.name));
      if (key !== lastPlacesKey.current) {
        setCategoryMarkers(places);
        lastPlacesKey.current = key;

        if (mapRef?.current && places.length > 0) {
          mapRef.current.fitToCoordinates(
            places.map((p) => p.coordinate),
            {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            }
          );
        }
      }
      return places;
    } finally {
      setLoadingCategory(false);
    }
  }

  async function searchThisArea({ activeCategory: type, mapRef, region, setRegion }) {
    if (!type) return null;
    setLoadingCategory(true);
    try {
      let center = region;
      if (mapRef?.current?.getCamera) {
        const cam = await mapRef.current.getCamera();
        center = {
          latitude: cam.center.latitude,
          longitude: cam.center.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        };
        setRegion(center);
      }

      const newMarkers = await getNearbyPlaces(center, type);

      if (
        categoryMarkers.length === newMarkers.length &&
        categoryMarkers.every((m, i) => m.place_id === newMarkers[i].place_id)
      ) {
        // aynı veri ise güncellemeyi atla
        return categoryMarkers;
      } else {
        setCategoryMarkers(newMarkers);
        if (mapRef?.current && newMarkers.length > 0) {
          mapRef.current.fitToCoordinates(
            newMarkers.map(m => m.coordinate),
            {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            }
          );
        }
        return newMarkers;
      }
    } finally {
      setMapMoved(false);
      setLoadingCategory(false);
    }
  }

  return {
    activeCategory, setActiveCategory,
    categoryMarkers, setCategoryMarkers,
    loadingCategory,
    mapMoved, setMapMoved,
    loadCategory,
    searchThisArea,
  };
}
