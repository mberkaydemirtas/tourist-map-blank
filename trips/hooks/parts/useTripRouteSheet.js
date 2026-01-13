// trips/hooks/parts/useTripRouteSheet.js
import { useState, useCallback, useRef } from 'react';
import Constants from 'expo-constants';

import { getRouteDirections } from '../../services/RouteDirectionService';
import { buildWaypointFromAct } from './useTripSegments';

const DIRECTIONS_API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

/**
 * Gün içi iki aktivite arasındaki rotayı hesaplar,
 * bottom sheet için state tutar ve haritayı o rotaya göre zoomlar.
 */
export function useTripRouteSheet({ day, mapRef, uiToReal, setIsPanelOpen }) {
  const [routeData, setRouteData] = useState(null);
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);

  const [legSel, setLegSel] = useState(null);      // {from, to}
  const [legActs, setLegActs] = useState(null);    // {a, b}

  // ✅ KRİTİK: null değil [] olsun (reset ve render tarafı stabil)
  const [legWaypoints, setLegWaypoints] = useState([]); // [w1, w2]

  const [routeLegLabel, setRouteLegLabel] = useState('');

  // ✅ Çakışan async çağrılar birbirini ezmesin (gün değişince / hızlı tıklayınca)
  const reqIdRef = useRef(0);

  /**
   * Basit: day.activities[realIdx] & [realIdx+1] arasını göster
   */
  const pickLeg = useCallback(
    async (realIdx) => {
      const acts = day?.activities || [];
      const a = acts[realIdx];
      const b = acts[realIdx + 1];
      if (!a || !b) return;

      const w1 = buildWaypointFromAct(a);
      const w2 = buildWaypointFromAct(b);
      if (!w1 || !w2) return;

      const reqId = ++reqIdRef.current;

      setLegSel({ from: realIdx, to: realIdx + 1 });
      setLegActs({ a, b });
      setLegWaypoints([w1, w2]);
      setRouteLegLabel('');
      setIsPanelOpen?.(false);

      try {
        const data = await getRouteDirections({
          waypoints: [w1, w2],
          mode: 'driving',
          apiKey: DIRECTIONS_API_KEY,
        });

        // ✅ eski request döndüyse ignore
        if (reqId !== reqIdRef.current) return;

        setRouteData(data);
        setRouteSheetOpen(true);

        if (data?.polylineCoords?.length && mapRef?.current) {
          try {
            mapRef.current.fitToCoordinates(data.polylineCoords, {
              edgePadding: { top: 80, right: 80, bottom: 160, left: 80 },
              animated: true,
            });
          } catch {}
        }
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setRouteSheetOpen(true);
      }
    },
    [day, mapRef, setIsPanelOpen]
  );

  /**
   * UI index çifti ile rota (anchor hariç tutmak için uiToReal kullanır)
   */
  const onPickLegPair = useCallback(
    async (...args) => {
      if (!day?.activities?.length) return;

      let fromUi = null;
      let toUi = null;
      let label = '';

      if (args.length === 1 && typeof args[0] === 'object') {
        const obj = args[0];
        fromUi =
          typeof obj.from === 'number'
            ? obj.from
            : typeof obj.fromIndex === 'number'
            ? obj.fromIndex
            : null;
        toUi =
          typeof obj.to === 'number'
            ? obj.to
            : typeof obj.toIndex === 'number'
            ? obj.toIndex
            : null;

        if (obj?.label && typeof obj.label === 'string') label = obj.label;
      } else if (args.length >= 2) {
        fromUi = args[0];
        toUi = args[1];
      }

      if (fromUi == null || toUi == null) return;

      const fromReal = uiToReal ? uiToReal(fromUi) : fromUi;
      const toReal = uiToReal ? uiToReal(toUi) : toUi;

      if (fromReal == null || toReal == null || fromReal === toReal || fromReal < 0 || toReal < 0) {
        return;
      }

      const acts = day.activities || [];
      const a = acts[fromReal];
      const b = acts[toReal];
      if (!a || !b) return;

      const w1 = buildWaypointFromAct(a);
      const w2 = buildWaypointFromAct(b);
      if (!w1 || !w2) return;

      const reqId = ++reqIdRef.current;

      setLegSel({ from: fromReal, to: toReal });
      setLegActs({ a, b });
      setLegWaypoints([w1, w2]);
      setRouteLegLabel(label || '');
      setIsPanelOpen?.(false);

      try {
        const data = await getRouteDirections({
          waypoints: [w1, w2],
          mode: 'driving',
          apiKey: DIRECTIONS_API_KEY,
        });

        if (reqId !== reqIdRef.current) return;

        setRouteData(data);
        setRouteSheetOpen(true);

        if (data?.polylineCoords?.length && mapRef?.current) {
          try {
            mapRef.current.fitToCoordinates(data.polylineCoords, {
              edgePadding: { top: 80, right: 80, bottom: 160, left: 80 },
              animated: true,
            });
          } catch {}
        }
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setRouteSheetOpen(true);
      }
    },
    [day, mapRef, uiToReal, setIsPanelOpen]
  );

  return {
    routeData,
    setRouteData,
    routeSheetOpen,
    setRouteSheetOpen,
    legSel,
    setLegSel,
    legActs,
    setLegActs,
    legWaypoints,
    setLegWaypoints,
    routeLegLabel,
    setRouteLegLabel,
    pickLeg,
    onPickLegPair,
  };
}
