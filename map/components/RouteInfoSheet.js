// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';
import { checkLocationReady } from '../utils/locationUtils';

const fmtDistance = (m) =>
  Number.isFinite(Number(m)) ? `${(Number(m) / 1000).toFixed(1)} km` : '—';
const fmtDuration = (s) =>
  Number.isFinite(Number(s)) ? `${Math.round(Number(s) / 60)} dk` : '—';

const RouteInfoSheet = forwardRef(({
  distance,           // (opsiyonel) üstten ham metre gelebilir
  duration,           // (opsiyonel) üstten ham saniye gelebilir
  fromLocation,
  toLocation,
  selectedMode,
  onModeChange,       // beklenen: routeId (primary.id)
  onCancel,
  onStart,
  routeOptions = {},
  children,
}, ref) => {
  const innerRef = useRef(null);
  const navigation = useNavigation();

  const getPrimary = (mode) => {
    const arr = routeOptions?.[mode] || [];
    return arr.find(r => r.isPrimary) || null;
  };

  const modeOptions = [
    { key: 'driving', label: '🚗' },
    { key: 'walking', label: '🚶‍♂️' },
    { key: 'transit', label: '🚌' },
  ];

  const selectedPrimary = getPrimary(selectedMode);

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
    const polyline = selectedPrimary?.polyline;
    const steps = selectedPrimary?.steps || [];
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
    onCancel?.();
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
          {/* Üst özet — seçili modun primary rotası varsa onu göster, yoksa prop'lardan düş */}
          <Text>Mesafe: {fmtDistance(selectedPrimary?.distance ?? distance)}</Text>
          <Text>Süre: {fmtDuration(selectedPrimary?.duration ?? duration)}</Text>

          <View style={styles.modeContainer}>
            {modeOptions.map(option => {
              const primary = getPrimary(option.key);
              const isSelected = selectedMode === option.key;
              const isDisabled = !primary; // bu modda hiç rota yok

              return (
                <TouchableOpacity
                  key={option.key}
                  activeOpacity={isDisabled ? 1 : 0.7}
                  style={[
                    styles.modeButton,
                    isSelected && styles.modeButtonSelected,
                    isDisabled && styles.modeButtonDisabled,
                  ]}
                  onPress={() => {
                    if (!isDisabled) {
                      // handleSelectRoute bekliyor: primary.id
                      onModeChange?.(primary.id);
                    }
                  }}
                >
                  <Text style={[
                    styles.modeText,
                    isSelected && styles.modeTextSelected,
                    isDisabled && styles.modeTextDisabled,
                  ]}>
                    {option.label}
                  </Text>

                  <Text style={[
                    styles.modeLabel,
                    isSelected && styles.modeLabelSelected,
                    isDisabled && styles.modeLabelDisabled,
                  ]}>
                    {fmtDistance(primary?.distance)} • {fmtDuration(primary?.duration)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 🚇 Transit mod detaylı adımları (varsa) */}
          {selectedMode === 'transit' && Array.isArray(selectedPrimary?.steps) && selectedPrimary.steps.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {selectedPrimary.steps.map((step, index) => {
                const isTransit = !!step.transit_details; // Google steps'te varsa
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
                  const dTxt = step.distance?.text || fmtDistance(step.distance?.value);
                  const tTxt = step.duration?.text || fmtDuration(step.duration?.value);
                  const instruction = step.maneuver?.instruction || '';
                  return (
                    <View key={index} style={{ marginBottom: 8 }}>
                      <Text style={{ fontSize: 14 }}>🚶 {dTxt} ({tTxt})</Text>
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
  modeButtonDisabled: {
    opacity: 0.45,
  },
  modeText: {
    fontSize: 20,
    color: 'black',
  },
  modeTextSelected: {
    color: 'white',
  },
  modeTextDisabled: {
    color: '#666',
  },
  modeLabel: {
    fontSize: 12,
    color: '#333',
    marginTop: 4,
  },
  modeLabelSelected: {
    color: 'white',
  },
  modeLabelDisabled: {
    color: '#666',
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
