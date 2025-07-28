// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';

const RouteInfoSheet = forwardRef(({
  distance,
  duration,
  onCancel,
  onStart,
  snapPoints = ['50%'],   // TEST İÇİN %50 yaptık
  children,
}, ref) => {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.present(),
    dismiss: () => innerRef.current?.dismiss(),
  }));

  return (
    <BottomSheetModal
      ref={innerRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      enableHandlePanningGesture={true}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={onCancel}
    >
      <BottomSheetView style={styles.container}>
        {/* HEADER */}
        {children}

        {/* CONTENT */}
        <View style={styles.content}>
          <Text style={styles.infoText}>Mesafe: {distance?.text || distance || '–'}</Text>
          <Text style={styles.infoText}>Süre: {duration?.text || duration || '–'}</Text>
          <Button title="Başlat" onPress={onStart} />
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

export default RouteInfoSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: 'white',
  },
  handleIndicator: {
    backgroundColor: '#CCC',
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: 8,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  infoText: {
    fontSize: 16,
    marginBottom: 8,
  },
});
