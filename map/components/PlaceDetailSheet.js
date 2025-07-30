import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import PlaceDetailHeader from './PlaceDetailHeader';
import PlaceOpeningHours from './PlaceOpeningHours';
import PlacePhotoGallery from './PlacePhotoGallery';
import PlaceContactButtons from './PlaceContactButtons';

const PlaceDetailSheet = forwardRef(function PlaceDetailSheet(
  { marker, routeInfo, snapPoints, onGetDirections },
  ref
) {
  const innerRef = useRef(null);

  // Dışarıdan erişim için imperative API
  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    snapToIndex: (index) => innerRef.current?.snapToIndex?.(index),
  }));

  return (
    <BottomSheet
      ref={innerRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableContentPanningGesture={false}
      enableHandlePanningGesture
      handleComponent={() => (
        <PlaceDetailHeader
          marker={marker}
          routeInfo={routeInfo}
          onGetDirections={onGetDirections}
        />
      )}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.sheetScroll}
        nestedScrollEnabled
      >
        <PlaceOpeningHours marker={marker} />
        <PlacePhotoGallery marker={marker} />
        <PlaceContactButtons marker={marker} />
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
