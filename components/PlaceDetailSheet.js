import React from 'react';
import { StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import PlaceDetailHeader from './PlaceDetailHeader';
import PlaceOpeningHours from './PlaceOpeningHours';
import PlacePhotoGallery from './PlacePhotoGallery';
import PlaceContactButtons from './PlaceContactButtons';

export default function PlaceDetailSheet({
  marker,
  routeInfo,
  sheetRef,
  snapPoints,
  onGetDirections,
}) {
  return (
    <BottomSheet
      ref={sheetRef}
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
}

const styles = StyleSheet.create({
  sheetScroll: {
    padding: 20,
    paddingBottom: 40,
  },
});
