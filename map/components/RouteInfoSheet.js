// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';
import { checkLocationReady } from '../utils/locationUtils';

const RouteInfoSheet = forwardRef(({
  distance,
  duration,
  fromLocation,
  toLocation,
  selectedMode,
  onModeChange,
  onCancel,
  onStart,
  routeOptions = {},
  children,
}, ref) => {
  const innerRef = useRef(null);
  const navigation = useNavigation();
  const getPrimary = mode => {
  const arr = routeOptions[mode] || [];
  return arr.find(r => r.isPrimary) || arr[0] || {};
};
  const modeOptions = [
    { key: 'driving', label: '🚗' },
    { key: 'walking', label: '🚶‍♂️' },
    { key: 'transit', label: '🚌' },
  ];
const selectedRoute = getPrimary(selectedMode);

  // expose present/dismiss to parent via ref
  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.present(),
    dismiss: () => innerRef.current?.dismiss(),
  }));


  const handleStartNavigation = async () => {
  if (!fromLocation?.coords || !toLocation?.coords) {
    Alert.alert('Eksik Bilgi', 'Lütfen önce nereden ve nereye gideceğinizi seçin.');
    return;
  }

  const ready = await checkLocationReady();
  if (!ready) {
    Alert.alert(
      'Konum Servisi Gerekli',
      'Navigasyonu başlatmak için konum izni vermeli ve GPS\'i açmalısınız.',
      [{ text: 'Tamam', onPress: () => {} }]
    );
    return;
  }

  // 🧠 Verileri önce al
  const from = {
    lat: fromLocation.coords.latitude,
    lng: fromLocation.coords.longitude,
  };
  const to = {
    lat: toLocation.coords.latitude,
    lng: toLocation.coords.longitude,
  };
  const polyline = selectedRoute?.polyline;
  const steps = selectedRoute?.steps || [];
  const mode = selectedMode;

  // Modalı kapat
  innerRef.current?.dismiss();

  // 🔀 Navigasyon ekranına geçiş
  navigation.navigate('NavigationScreen', {
    from,
    to,
    polyline,
    steps,
    mode,
  });

  // 🧼 Sonra state temizle
  onCancel?.(); // bu zaten çoğunu yapıyor ama garanti için:

};

  const renderTransitSteps = (steps = []) => {
  return (
    <View style={{ marginTop: 12 }}>
      {steps.map((step, index) => {
        const isTransit = step.transit_details != null;

        if (isTransit) {
          const lineName = step.transit_details?.line?.short_name || step.transit_details?.line?.name || 'Hat';
          const vehicle = step.transit_details?.line?.vehicle?.type || '';
          const from = step.transit_details?.departure_stop?.name || 'Durağından';
          const to = step.transit_details?.arrival_stop?.name || 'Durağına';
          const numStops = step.transit_details?.num_stops ?? '?';
          return (
            <View key={index} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 14 }}>🚌 {lineName} ({vehicle})</Text>
              <Text style={{ fontSize: 13, color: '#444' }}>{from} → {to} ({numStops} durak)</Text>
            </View>
          );
        } else {
          const distance = step.distance?.text || '';
          const duration = step.duration?.text || '';
          const instruction = step.maneuver?.instruction || '';
          return (
            <View key={index} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 14 }}>🚶 {distance} ({duration})</Text>
              <Text style={{ fontSize: 13, color: '#444' }}>{instruction}</Text>
            </View>
          );
        }
      })}
    </View>
  );
};

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
        <Text>Mesafe: {selectedRoute?.distance || '—'}</Text>
        <Text>Süre: {selectedRoute?.duration || '—'}</Text>


        <View style={styles.modeContainer}>
          {modeOptions.map(option => {
            const route = (routeOptions?.[option.key] || []).find(r => r.isPrimary);

            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.modeButton,
                  selectedMode === option.key && styles.modeButtonSelected
                ]}
                 onPress={() => {
    const primary = (routeOptions[option.key] || []).find(r => r.isPrimary)
    if (primary) {
      onModeChange(primary.id)
    }
  }}
              >
                <Text style={styles.modeText}>{option.label}</Text>
                <Text style={styles.modeLabel}>
               {route?.distance || '—'} • {route?.duration || '—'}
         </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 🚇 Transit mod detaylı adımları */}
         {selectedMode === 'transit' && selectedRoute.steps?.length > 0 && (
          
          <View style={{ marginTop: 12 }}>
            {selectedRoute.steps.map((step, index) => {
              const isTransit = step.transit_details != null;

              if (isTransit) {
                const lineName = step.transit_details?.line?.short_name || step.transit_details?.line?.name || 'Hat';
                const vehicle = step.transit_details?.line?.vehicle?.type || '';
                const from = step.transit_details?.departure_stop?.name || 'Başlangıç';
                const to = step.transit_details?.arrival_stop?.name || 'Varış';
                const numStops = step.transit_details?.num_stops ?? '?';
                return (
                  <View key={index} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 14 }}>🚌 {lineName} ({vehicle})</Text>
                    <Text style={{ fontSize: 13, color: '#444' }}>
                      {from} → {to} ({numStops} durak)
                    </Text>
                  </View>
                );
              } else {
                const distance = step.distance?.text || '';
                const duration = step.duration?.text || '';
                const instruction = step.maneuver?.instruction || '';
                return (
                  <View key={index} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 14 }}>🚶 {distance} ({duration})</Text>
                    <Text style={{ fontSize: 13, color: '#444' }}>{instruction}</Text>
                  </View>
                );
              }
            })}
          </View>
        )}

        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartNavigation}
        >
          <Text style={styles.buttonText}>Başlat</Text>
        </TouchableOpacity>
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
  startButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
