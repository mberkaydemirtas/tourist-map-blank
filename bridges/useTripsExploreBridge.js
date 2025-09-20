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
 * - presetCategory: 'lodging' | 'restaurant' | 'cafe' | ... (MapScreen'de kategori otomatik açılsın)
 * - search: string (MapScreen arama kutusu önceden doldurulsun)
 * - sheetInitial: 'half' | 'full' | undefined (PlaceDetailSheet başlangıç snap'i)
 */
export function useTripsExploreBridge({ nav, route, onPick }) {
  const resolverRef = useRef(null);

  const normalizeCenter = (center) => {
    if (!center) return undefined;
    const lat = Number(center.lat ?? center.latitude);
    const lng = Number(center.lng ?? center.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  };

  /**
   * @param {{
   *  which?: 'start'|'end'|'lodging',
   *  cityKey?: string,
   *  center?: {lat:number,lng:number}|{latitude:number,longitude:number},
   *  cityName?: string,
   *  sheetInitial?: 'half'|'full',
   *  awaitSelection?: boolean,            // true ise Promise döner ve seçim beklenir
   *  presetCategory?: string,             // örn: 'lodging'
   *  search?: string                      // arama kutusuna başlangıç değeri
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
      presetCategory,       // 👈 yeni
      search,               // 👈 yeni
    } = opts;

    const centerNorm = normalizeCenter(center);
    const version = Date.now();

    if (awaitSelection) {
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
              sheetInitial,     // örn: 'half'
              presetCategory,   // 👈 yeni
              search,           // 👈 yeni
              version,
            },
          },
        });
      });
    }

    // Seçim beklenmeyecekse direkt git
    resolverRef.current = null;
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
          presetCategory,   // 👈 yeni
          search,           // 👈 yeni
          version,
        },
      },
    });
  }, [nav]);

  const openStartEndPicker = useCallback(({ which, cityKey, cityObj, search } = {}) => {
    // which: 'start' | 'end'
    return openPicker({
      which,
      cityKey,
      center: cityObj?.center,
      cityName: cityObj?.name,
      awaitSelection: true,   // başlangıç/bitiş seçiminde sonucu beklemek mantıklı
      search,
    });
  }, [openPicker]);

  const openLodgingPicker = useCallback(({ cityKey, cityObj, search } = {}) => {
    // Konaklama akışında genelde Promise akışı gerekmez; kullanıcı haritadan seçip Wizard'a döner.
    return openPicker({
      which: 'lodging',
      cityKey,
      center: cityObj?.center,
      cityName: cityObj?.name,
      sheetInitial: 'half',
      awaitSelection: false,      // 👈 konaklamada bekleme yok
      presetCategory: 'lodging',  // 👈 otomatik otel kategorisi
      search,                      // istersen arama kutusu doldurulabilir
    });
  }, [openPicker]);

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
