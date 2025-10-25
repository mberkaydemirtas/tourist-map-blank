// src/bridges/useTripsExploreBridge.js
import { useCallback, useEffect, useRef } from 'react';

/**
 * Wizard (CreateTripWizard) ile MapScreen arasında köprü.
 *
 * Özellikler:
 * - openPicker: Harita picker'ını açar ve (opsiyonel) Promise ile seçimi bekler.
 * - openStartEndPicker: 'start' | 'end' için sugar helper.
 * - openLodgingPicker: konaklama seçimi için sugar helper (half sheet + presetCategory='lodging').
 * - route.params.pickFromMap geldiğinde onPick callback'i tetikler ve varsa bekleyen Promise'i çözer.
 *
 * Navigation sözleşmesi:
 * - Map tarafı seçim yaptığında, navigator'a
 *   { screen: 'CreateTripWizard', params: { pickFromMap: { which, cityKey, hub } } }
 *   set edilir. (PlaceDetailSheetContainer bunu zaten yapıyor.)
 *
 * Ekstra:
 * - presetCategory: 'lodging' | 'restaurant' | 'cafe' | ...
 * - search: string
 */
export function useTripsExploreBridge({ nav, route, onPick }) {
  const resolverRef = useRef(null);

  const normalizeCenter = useCallback((center) => {
    if (!center) return undefined;
    const lat = Number(center.lat ?? center.latitude);
    const lng = Number(center.lng ?? center.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  }, []);

  /**
   * @param {{
   *  which?: 'start'|'end'|'lodging',
   *  cityKey?: string,
   *  center?: {lat:number,lng:number}|{latitude:number,longitude:number},
   *  cityName?: string,
   *  sheetInitial?: 'half'|'full',
   *  awaitSelection?: boolean,
   *  presetCategory?: string,
   *  search?: string
   * }} opts
   * @returns {Promise<any>|void}
   */
  const openPicker = useCallback((opts = {}) => {
    const {
      which,
      cityKey,
      center,
      cityName,
      sheetInitial,
      awaitSelection = true,
      presetCategory,
      search,
    } = opts;

    const centerNorm = normalizeCenter(center);
    const version = Date.now();

    const go = () =>
      nav.navigate('Keşfet', {
        screen: 'Map',
        params: {
          picker: {
            enabled: true,
            which,
            cityKey,
            center: centerNorm,
            cityName,
            sheetInitial,
            presetCategory,
            search,
            version,
          },
        },
      });

    if (awaitSelection) {
      return new Promise((resolve) => {
        resolverRef.current = resolve;
        go();
      });
    }

    resolverRef.current = null;
    go();
    return undefined;
  }, [nav, normalizeCenter]);

  const openStartEndPicker = useCallback(
    ({ which, cityKey, cityObj, search } = {}) => {
      return openPicker({
        which,
        cityKey,
        center: cityObj?.center,
        cityName: cityObj?.name,
        awaitSelection: true,
        search,
      });
    },
    [openPicker]
  );

  const openLodgingPicker = useCallback(
    ({ cityKey, cityObj, search } = {}) => {
      return openPicker({
        which: 'lodging',
        cityKey,
        center: cityObj?.center,
        cityName: cityObj?.name,
        sheetInitial: 'half',
        awaitSelection: false, // konaklama için akış asenkron kalabilir; Map tarafında selection sonrası dönüş yapılır
        presetCategory: 'lodging',
        search,
      });
    },
    [openPicker]
  );

  // MapScreen → Wizard geri dönüşünü dinle
  useEffect(() => {
    const pick = route?.params?.pickFromMap;
    if (!pick) return;

    // 1) Dışarıya bildir
    try {
      onPick?.(pick);
    } catch (e) {
      console.error('Error in onPick handler:', e);
    }

    // 2) Eğer openPicker ile Promise bekliyorsak, hub/place'i çözelim
    if (resolverRef.current) {
      const payload =
        pick && (pick.hub || pick.place) ? (pick.hub || pick.place) : pick;
      try {
        resolverRef.current(payload);
      } catch (e) {
        console.error('Error resolving picker promise:', e);
      } finally {
        resolverRef.current = null;
      }
    }

    // 3) Param temizliği: Wizard tarafında (handler finally > setTimeout) temizlenecek.
  }, [route?.params?.pickFromMap, onPick]);

  return {
    openPicker,
    openStartEndPicker,
    openLodgingPicker,
  };
}
