import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import PlaceDetailHeader from './PlaceDetailHeader';
import PlaceOpeningHours from './PlaceOpeningHours';
import PlacePhotoGallery from './PlacePhotoGallery';
import PlaceContactButtons from './PlaceContactButtons';
import { toCoordsObject, normalizeCoord } from '../utils/coords';

const PlaceDetailSheet = forwardRef(function PlaceDetailSheet(
  {
    marker,
    routeInfo,
    snapPoints = ['30%', '60%', '75%', '90%'], // default snappoints
    onGetDirections,
    onDismiss,
    // optional CTA override (start/end/lodging gibi durumlar için)
    overrideCtaLabel,
    overrideCtaOnPress,
  },
  ref
) {
  const innerRef = useRef(null);

  // Imperative API
  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    snapToIndex: (index) => innerRef.current?.snapToIndex?.(index),
  }));

  // default CTA davranışı (Yol Tarifi Al)
  const handleGetDirectionsPress = () => {
    if (!marker || !onGetDirections) return;
    const normalized =
      toCoordsObject(marker) ??
      {
        ...marker,
        coords: normalizeCoord(
          marker?.coords ?? marker?.coordinate ?? marker?.geometry?.location ?? marker
        ),
      };
    onGetDirections(normalized);
  };

  // primary CTA: override varsa onu kullan; yoksa default
  const primaryCtaHandler = () => {
    if (typeof overrideCtaOnPress === 'function') {
      overrideCtaOnPress(marker);
    } else {
      handleGetDirectionsPress();
    }
  };
  const primaryCtaLabel = overrideCtaLabel || 'Yol Tarifi Al';

  return (
    <BottomSheet
      ref={innerRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableContentPanningGesture={false}
      enableHandlePanningGesture
      onChange={(idx) => {
        // bazı sürümlerde kapandığında -1 dönmeyebilir; yine de güvenli olsun
        if (idx === -1 && typeof onDismiss === 'function') onDismiss();
      }}
      onClose={() => { typeof onDismiss === 'function' && onDismiss(); }}
      handleComponent={() => (
        <PlaceDetailHeader
          marker={marker}
          routeInfo={routeInfo}
          onGetDirections={primaryCtaHandler}
          // Header'ın bu prop'u desteklediğinden emin ol
          ctaLabel={primaryCtaLabel}
        />
      )}
    >
      <BottomSheetScrollView contentContainerStyle={styles.sheetScroll} nestedScrollEnabled>
        {/* marker yokken ağır bileşenleri render etmeyelim */}
        {marker && (
          <>
            <PlaceOpeningHours marker={marker} />
            <PlacePhotoGallery marker={marker} />
            <PlaceContactButtons marker={marker} />
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

export default PlaceDetailSheet;

const styles = StyleSheet.create({
  sheetScroll: {
    padding: 20,
    paddingBottom: 40,
  },
});
