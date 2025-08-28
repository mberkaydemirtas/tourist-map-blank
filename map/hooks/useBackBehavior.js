// src/hooks/useBackBehavior.js
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * @param {object} params
 * @param {'explore'|'route'} params.mode
 * @param {React.MutableRefObject<boolean>} params.placeSheetOpenRef
 * @param {React.MutableRefObject<any>} params.placeSheetRef
 * @param {React.MutableRefObject<boolean>} params.routeSheetPresentedRef
 * @param {Function} params.dismissRouteSheet
 * @param {Function} params.handleCancelRoute
 */
export function useBackBehavior({
  mode,
  placeSheetOpenRef,
  placeSheetRef,
  routeSheetPresentedRef,
  dismissRouteSheet,
  handleCancelRoute,
}) {
  useEffect(() => {
    const onBack = () => {
      // 1) Route sheet açıksa kapat
      if (routeSheetPresentedRef?.current) {
        dismissRouteSheet?.();
        return true;
      }
      // 2) Place sheet açıksa kapat
      if (placeSheetOpenRef?.current) {
        placeSheetRef?.current?.close?.();
        return true;
      }
      // 3) Route modundaysa explore'a dön
      if (mode === 'route') {
        handleCancelRoute?.();
        return true;
      }
      return false; // default davranış
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [mode, dismissRouteSheet, handleCancelRoute, placeSheetOpenRef, placeSheetRef, routeSheetPresentedRef]);
}
