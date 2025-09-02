import { useCallback, useEffect, useRef } from 'react';

/**
 * Wizard (CreateTripWizard) ile MapScreen arasında köprü.
 *
 * Özellikler:
 * - openPicker: Harita picker'ını açar ve (opsiyonel) Promise ile seçimi bekler.
 * - openStartEndPicker: 'start' | 'end' için sugar helper.
 * - openLodgingPicker: konaklama seçimi için sugar helper (half sheet).
 * - route.params.pickFromMap geldiğinde onPick callback'i tetikler ve varsa bekleyen Promise'i çözer.
 *
 * Navigation sözleşmesi:
 * - Map tarafı seçim yaptığında, navigator'a
 *   { screen: 'CreateTripWizard', params: { pickFromMap: { which, cityKey, hub } } }
 *   set edilir. (PlaceDetailSheetContainer bunu zaten yapıyor.)
 */
export function useTripsExploreBridge({ nav, route, onPick }) {
  const resolverRef = useRef(null);

  const normalizeCenter = (center) => {
    if (!center) return undefined;
    const lat = Number(center.lat ?? center.latitude);
    const lng = Number(center.lng ?? center.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  };

  const openPicker = useCallback(({ which, cityKey, center, cityName, sheetInitial } = {}) => {
    const centerNorm = normalizeCenter(center);
    return new Promise((resolve) => {
      resolverRef.current = resolve; // seçim gelirse Promise'i çözeceğiz
      nav.navigate('Keşfet', {
        screen: 'Map',
        params: {
          picker: {
            enabled: true,
            which,            // 'start' | 'end' | 'lodging'
            cityKey,
            center: centerNorm,
            cityName,
            sheetInitial,     // örn: 'half' (konaklama için yarım açılış)
            version: Date.now(),
          },
        },
      });
    });
  }, [nav]);

  const openStartEndPicker = useCallback(({ which, cityKey, cityObj }) => {
    // which: 'start' | 'end'
    return openPicker({
      which,
      cityKey,
      center: cityObj?.center,
      cityName: cityObj?.name,
    });
  }, [openPicker]);

  const openLodgingPicker = useCallback(({ cityKey, cityObj }) => {
    // Konaklama akışında Promise beklemek istemiyorsan resolve edilmese de olur.
    // LodgingQuestion zaten dönüşte state'e item push ediyor.
    resolverRef.current = null; // konaklamada Promise akışına gerek yok
    nav.navigate('Keşfet', {
      screen: 'Map',
      params: {
        picker: {
          enabled: true,
          which: 'lodging',
          cityKey,
          center: normalizeCenter(cityObj?.center),
          cityName: cityObj?.name,
          sheetInitial: 'half',
          version: Date.now(),
        },
      },
    });
  }, [nav]);

  // MapScreen → Wizard geri dönüşünü dinle
  useEffect(() => {
    const pick = route.params?.pickFromMap;
    if (!pick) return;

    // Dışarıya bildir
    try { onPick?.(pick); } catch {}

    // Eğer openPicker ile Promise bekliyorsak, hub'ı çözelim
    if (resolverRef.current) {
      try { resolverRef.current(pick.hub); } catch {}
      resolverRef.current = null;
    }

    // paramı temizle (loop önler)
    nav.setParams({ pickFromMap: undefined });
  }, [route.params?.pickFromMap, nav, onPick]);

  return {
    openPicker,
    openStartEndPicker,
    openLodgingPicker,
  };
}
