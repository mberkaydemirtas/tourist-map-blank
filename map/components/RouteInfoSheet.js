// src/components/RouteInfoSheet.js
import React, { forwardRef, useImperativeHandle, useRef, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';
import { checkLocationReady } from '../utils/locationUtils';

const fmtDistance = (m) => Number.isFinite(Number(m)) ? `${(Number(m) / 1000).toFixed(1)} km` : '—';
const fmtDuration = (s) => Number.isFinite(Number(s)) ? `${Math.round(Number(s) / 60)} dk` : '—';

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
  waypoints = [],              // 👈 YENİ
  children,
}, ref) => {
  const innerRef = useRef(null);
  const navigation = useNavigation();

  const getPrimary = (mode) => {
    const arr = routeOptions?.[mode] || [];
    return arr.find(r => r.isPrimary) || arr[0] || null;
  };

  const selectedPrimary = useMemo(() => getPrimary(selectedMode), [routeOptions, selectedMode]);

  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.present(),
    dismiss: () => innerRef.current?.dismiss(),
  }));

  useEffect(() => {
    const hasCoords = !!(fromLocation?.coords && toLocation?.coords);
    const hasMetrics = Number.isFinite(selectedPrimary?.distance ?? distance)
                    && Number.isFinite(selectedPrimary?.duration ?? duration);
    if (hasCoords && hasMetrics) innerRef.current?.present();
  }, [fromLocation?.coords, toLocation?.coords, selectedPrimary, distance, duration]);

  const handleStartNavigation = async () => {
    if (!fromLocation?.coords || !toLocation?.coords) {
      Alert.alert('Eksik Bilgi', 'Lütfen önce nereden ve nereye gideceğinizi seçin.');
      return;
    }
    const ready = await checkLocationReady();
    if (!ready) {
      Alert.alert('Konum Servisi Gerekli', 'Navigasyonu başlatmak için konum izni vermeli ve GPS\'i açmalısınız.', [{ text: 'Tamam' }]);
      return;
    }

    const from = { lat: fromLocation.coords.latitude, lng: fromLocation.coords.longitude };
    const to   = { lat: toLocation.coords.latitude,   lng: toLocation.coords.longitude   };
    const polyline = selectedPrimary?.polyline;
    const steps    = selectedPrimary?.steps || [];
    const mode     = selectedMode;

    innerRef.current?.dismiss();

    navigation.navigate('NavigationScreen', {
      from,
      to,
      polyline,
      steps,
      mode,
      waypoints,                 // 👈 DURAKLARI DA GÖNDER
    });

    onCancel?.();
  };

  const modeOptions = [
    { key: 'driving', label: '🚗' },
    { key: 'walking', label: '🚶‍♂️' },
    { key: 'transit', label: '🚌' },
  ];

  return (
    <BottomSheetModal
      ref={innerRef}
      snapPoints={['30%', '60%', '90%']}
      enablePanDownToClose={false}
      enableHandlePanningGesture
      enableContentPanningGesture
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      topInset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
      onDismiss={onCancel}
    >
      <BottomSheetView style={styles.container}>
        {children}

        <View style={styles.content}>
          <Text>Mesafe: {fmtDistance(selectedPrimary?.distance ?? distance)}</Text>
          <Text>Süre: {fmtDuration(selectedPrimary?.duration ?? duration)}</Text>

          <View style={styles.modeContainer}>
            {modeOptions.map(option => {
              const primary = getPrimary(option.key);
              const isSelected = selectedMode === option.key;
              const isDisabled = !primary;

              return (
                <TouchableOpacity
                  key={option.key}
                  activeOpacity={isDisabled ? 1 : 0.7}
                  style={[
                    styles.modeButton,
                    isSelected && styles.modeButtonSelected,
                    isDisabled && styles.modeButtonDisabled,
                  ]}
                  onPress={() => { if (!isDisabled) onModeChange?.(option.key); }}
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

          <TouchableOpacity style={styles.startButton} onPress={handleStartNavigation}>
            <Text style={styles.buttonText}>Başlat</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

export default RouteInfoSheet;

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: 'white' },
  handleIndicator: {
    backgroundColor: '#CCC',
    width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 8,
  },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  modeContainer: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  modeButton: { padding: 10, borderRadius: 8, backgroundColor: '#eee', alignItems: 'center', minWidth: 90 },
  modeButtonSelected: { backgroundColor: '#007AFF' },
  modeButtonDisabled: { opacity: 0.45 },
  modeText: { fontSize: 20, color: 'black' },
  modeTextSelected: { color: 'white' },
  modeTextDisabled: { color: '#666' },
  modeLabel: { fontSize: 12, color: '#333', marginTop: 4 },
  modeLabelSelected: { color: 'white' },
  modeLabelDisabled: { color: '#666' },
  startButton: { backgroundColor: '#007AFF', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
