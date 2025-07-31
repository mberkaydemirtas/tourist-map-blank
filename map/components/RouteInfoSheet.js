// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';

const RouteInfoSheet = forwardRef(({
  distance,
  duration,
  fromLocation,  // ✅ MapScreen'den gelen: fromSource objesi
  toLocation,
  onCancel,
  onStart,
  snapPoints = ['50%'],
  children,
}, ref) => {
  const innerRef = useRef(null);
  const navigation = useNavigation();

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
          
          <Button
            title="Başlat"
            onPress={() => {
              if (!fromLocation?.coords || !toLocation?.coords) {
                Alert.alert('Eksik Bilgi', 'Lütfen önce nereden ve nereye gideceğinizi seçin.');
                return;
              }

              navigation.navigate('NavigationScreen', {
                from: {
                  lat: fromLocation.coords.latitude,
                  lng: fromLocation.coords.longitude,
                },
                to: {
                  lat: toLocation.coords.latitude,
                  lng: toLocation.coords.longitude,
                },
              });
            }}
          />
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
