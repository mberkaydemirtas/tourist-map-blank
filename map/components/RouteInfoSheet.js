// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, Button, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';

const RouteInfoSheet = forwardRef(({
  distance,
  duration,
  fromLocation,
  toLocation,
  selectedMode,
  onModeChange,
  onCancel,
  onStart,
  routeOptions, // 👈 her mod için mesafe/süre/polilyne içeren objeler
  children,
}, ref) => {
  const innerRef = useRef(null);
  const navigation = useNavigation();

  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.present(),
    dismiss: () => innerRef.current?.dismiss(),
  }));

  const modeOptions = [
    { key: 'driving', label: '🚗' },
    { key: 'walking', label: '🚶‍♂️' },
    { key: 'cycling', label: '🚴‍♂️' },
  ];

  return (
    <BottomSheetModal
      ref={innerRef}
      index={0}
      snapPoints={['30%', '60%', '90%']}
      enablePanDownToClose={false}
      enableHandlePanningGesture={true}
      enableContentPanningGesture={true}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={onCancel}
    >
      <BottomSheetView style={styles.container}>
        {children}

        <View style={styles.content}>
          <Text style={styles.infoText}>Mesafe: {distance?.text || distance || '–'}</Text>
          <Text style={styles.infoText}>Süre: {duration?.text || duration || '–'}</Text>

          <View style={styles.modeContainer}>
            {modeOptions.map(option => {
              const route = routeOptions?.[option.key];
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.modeButton,
                    selectedMode === option.key && styles.modeButtonSelected
                  ]}
                  onPress={() => onModeChange(option.key)}
                >
                  <Text style={styles.modeText}>{option.label}</Text>
                  <Text style={styles.modeLabel}>
                    {route?.distance || '—'} • {route?.duration || '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button
            title="Başlat"
            onPress={() => {
              if (!fromLocation?.coords || !toLocation?.coords) {
                Alert.alert('Eksik Bilgi', 'Lütfen önce nereden ve nereye gideceğinizi seçin.');
                return;
              }

              const selectedRoute = routeOptions?.[selectedMode];

              navigation.navigate('NavigationScreen', {
                from: {
                  lat: fromLocation.coords.latitude,
                  lng: fromLocation.coords.longitude,
                },
                to: {
                  lat: toLocation.coords.latitude,
                  lng: toLocation.coords.longitude,
                },
                polyline: selectedRoute?.polyline,
                steps: selectedRoute?.steps,
                mode: selectedMode,
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
  modeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  modeButton: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#eee',
    alignItems: 'center',
    minWidth: 90,
  },
  modeButtonSelected: {
    backgroundColor: '#007AFF',
  },
  modeText: {
    fontSize: 20,
    color: 'black',
  },
  modeLabel: {
    fontSize: 12,
    color: '#333',
    marginTop: 4,
  },
});
