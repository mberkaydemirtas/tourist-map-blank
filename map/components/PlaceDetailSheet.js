// src/components/PlaceDetailSheet.js
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
    snapPoints = ['30%', '60%', '75%', '90%'],
    onGetDirections,
    onDismiss,
    overrideCtaLabel,
    overrideCtaOnPress,
    onChange, // <-- yeni: dışarıdan gelen onChange
  },
  ref
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    snapToIndex: (index) => innerRef.current?.snapToIndex?.(index),
  }));

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
      onChange={onChange} // <-- dışarıdaki guard'lı handler
      onClose={() => { typeof onDismiss === 'function' && onDismiss(); }} // sadece gerçek kapanışta
      handleComponent={() => (
        <PlaceDetailHeader
          marker={marker}
          routeInfo={routeInfo}
          onGetDirections={primaryCtaHandler}
          ctaLabel={primaryCtaLabel}
        />
      )}
    >
      <BottomSheetScrollView contentContainerStyle={styles.sheetScroll} nestedScrollEnabled>
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
  sheetScroll: { padding: 20, paddingBottom: 40 },
});
