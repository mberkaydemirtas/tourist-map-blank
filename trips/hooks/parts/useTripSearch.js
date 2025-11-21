// trips/hooks/parts/useTripSearch.js
import { useState, useEffect, useCallback } from 'react';
import {
  limitPhotos,
  coercePhotoInputsToUrls,
} from '../../components/TripPlanHelpers';

/**
 * Arama barı, Google Places text search, insert / edit modları ve
 * "add" modundaki QuickCard state'ini yönetir.
 */
export function useTripSearch({
  DIRECTIONS_API_KEY,
  currentMapCenter,
  mapRef,
  uiToReal,
  guardAnchorAction,
  focusCorridorAround,
  addResolvedAtIndex,
  setIsPanelOpen,
}) {
  // UI state
  const [searchBarVisible, setSearchBarVisible] = useState(false);
  const [mapSearchQ, setMapSearchQ] = useState('');
  const [searchMarkers, setSearchMarkers] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);

  // QuickCard “add” / “existing” durumları
  const [sheetMarker, setSheetMarker] = useState(null);
  const [sheetVariant, setSheetVariant] = useState('add'); // add | existing
  const [sheetMeta, setSheetMeta] = useState('');

  // Insert / edit modları
  const [editIndex, setEditIndex] = useState(null);
  const [insertIndex, setInsertIndex] = useState(null);
  const [insertMode, setInsertMode] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null);

  /* ------------------- HANDLERS ------------------- */

  const onSelectSearchResult = useCallback(
    (marker) => {
      if (!marker) return;

      if (marker.coord && mapRef?.current) {
        try {
          mapRef.current.animateCamera({
            center: marker.coord,
            zoom: 15,
          });
        } catch {
          // ignore
        }
      }

      setSheetMarker(marker);
      setSheetVariant('add');
      setSheetMeta('search');
    },
    [mapRef]
  );

  const handleInsertAt = useCallback(
    (idxOrObj) => {
      const real = typeof idxOrObj === 'object' ? idxOrObj.index : idxOrObj;
      const realIdx = uiToReal(real);
      if (realIdx != null) {
        setInsertIndex(realIdx);
        setInsertMode(false);
        setIsPanelOpen(false);
        setSearchBarVisible(true);
        focusCorridorAround(realIdx);
      }
    },
    [uiToReal, focusCorridorAround, setIsPanelOpen]
  );

  const handleEditActivityAt = useCallback(
    (uiIdx) => {
      if (guardAnchorAction(uiIdx)) return;
      const realIdx = uiToReal(uiIdx);
      setEditIndex(realIdx);
      setInsertIndex(realIdx);
      setIsPanelOpen(false);
      setSearchBarVisible(true);
    },
    [guardAnchorAction, uiToReal, setIsPanelOpen]
  );

  const onPickInsertIndex = useCallback(
    (uiIdx) => {
      const realIdx = uiToReal(uiIdx);
      if (realIdx != null) {
        if (pendingAdd) addResolvedAtIndex(realIdx, pendingAdd);
        setPendingAdd(null);
        setInsertMode(false);
        setInsertIndex(null);
        setMapSearchQ('');
        setSearchMarkers([]);
        setSearchBarVisible(false);
      }
    },
    [
      uiToReal,
      pendingAdd,
      addResolvedAtIndex,
      setSearchMarkers,
      setSearchBarVisible,
    ]
  );

  const onCancelInsertMode = useCallback(() => {
    setPendingAdd(null);
    setInsertMode(false);
    setInsertIndex(null);
  }, []);

  /* ------------------- Google Places Text Search ------------------- */

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const q = (mapSearchQ || '').trim();
      if (!q) {
        setSearchMarkers([]);
        setSearchBusy(false);
        return;
      }
      if (q.length < 2) {
        setSearchMarkers([]);
        return;
      }
      if (!DIRECTIONS_API_KEY) {
        setSearchMarkers([]);
        return;
      }

      setSearchBusy(true);
      try {
        const center = currentMapCenter.current;
        const locationParam = center
          ? `&location=${center.lat},${center.lng}&radius=4000`
          : '';
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
          q
        )}${locationParam}&key=${DIRECTIONS_API_KEY}`;

        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;

        const results = Array.isArray(json.results) ? json.results : [];

        const markers = results
          .map((r) => {
            const loc = r.geometry?.location;
            const rawPhotos = r.photos || [];
            const photoUrls = limitPhotos(
              coercePhotoInputsToUrls(rawPhotos, DIRECTIONS_API_KEY, {
                maxwidth: 640,
              }),
              3
            );

            return {
              id:
                r.place_id ||
                r.id ||
                `${r.name}_${r.formatted_address}`,
              title: r.name || 'Sonuç',
              coord: loc
                ? {
                    latitude: loc.lat,
                    longitude: loc.lng,
                  }
                : null,
              address: r.formatted_address || '',
              place_id: r.place_id || null,
              photoUrls,
              photos: rawPhotos,
            };
          })
          .filter((m) => !!m.coord);

        setSearchMarkers(markers);
      } catch (e) {
        if (!cancelled) {
          console.warn('[Search] Yer arama hatası:', e?.message);
          setSearchMarkers([]);
        }
      } finally {
        !cancelled && setSearchBusy(false);
      }
    };

    if ((mapSearchQ || '').trim().length >= 2) {
      const t = setTimeout(run, 350);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    } else {
      setSearchMarkers([]);
      setSearchBusy(false);
    }
  }, [mapSearchQ, DIRECTIONS_API_KEY, currentMapCenter]);

  return {
    // state
    searchBarVisible,
    setSearchBarVisible,
    mapSearchQ,
    setMapSearchQ,
    searchMarkers,
    searchBusy,

    sheetMarker,
    setSheetMarker,
    sheetVariant,
    setSheetVariant,
    sheetMeta,
    setSheetMeta,

    editIndex,
    setEditIndex,
    insertIndex,
    setInsertIndex,
    insertMode,
    setInsertMode,
    pendingAdd,
    setPendingAdd,

    // handlers
    onSelectSearchResult,
    handleInsertAt,
    handleEditActivityAt,
    onPickInsertIndex,
    onCancelInsertMode,
  };
}
