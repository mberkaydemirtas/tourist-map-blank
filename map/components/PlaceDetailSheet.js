import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import PlaceDetailHeader from './PlaceDetailHeader';
import PlaceOpeningHours from './PlaceOpeningHours';
import PlacePhotoGallery from './PlacePhotoGallery';
import PlaceContactButtons from './PlaceContactButtons';
import { toCoordsObject, normalizeCoord } from '../utils/coords';

const PlaceDetailSheet = forwardRef(function PlaceDetailSheet(
  { marker, routeInfo, snapPoints, onGetDirections, onDismiss },
  ref
) {
  const innerRef = useRef(null);

  // Dışarıdan erişim için imperative API
  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    snapToIndex: (index) => innerRef.current?.snapToIndex?.(index),
  }));

   // "Yol Tarifi Al" tıklanınca marker'ı normalize edip üst bileşene gönder
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
 
   return (
    <BottomSheet
      ref={innerRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableContentPanningGesture={false}
      enableHandlePanningGesture
       onChange={(idx) => {
   // -1 kapalı; bazı versiyonlarda -1 dönmez, o yüzden idx === -1 ya da idx === 0 dışı gibi kontrol edebilirsin
   if (idx === -1) {
     // parent’a haber ver
    typeof onDismiss === 'function' && onDismiss();
   }
 }}
      handleComponent={() => (
        <PlaceDetailHeader
          marker={marker}
          routeInfo={routeInfo}
          onGetDirections={handleGetDirectionsPress}
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
