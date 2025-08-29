// src/map/containers/RouteInfoSheetContainer.js
import React, { forwardRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import RouteInfoSheet from '../components/RouteInfoSheet';

const RouteInfoSheetContainer = forwardRef(function RouteInfoSheetContainer(
  {
    distance,
    duration,
    map,
    snapPoints = ['30%'],
    onCancel,       // MapScreen'den: route'ı tamamen iptal + temizle
    onModeChange,   // routeId -> primary seçimi
    onModeRequest,  // veri yoksa hesaplat
    onStart,        // turn-by-turn'e geçiş
  },
  ref
) {
  // X’e basınca: önce sheet’i kapat, sonra onCancel ile route’u temizle
  const handleClosePress = useCallback(() => {
    try { ref?.current?.close?.(); } catch {}
    onCancel?.();
  }, [ref, onCancel]);

  return (
    <RouteInfoSheet
      ref={ref}
      distance={distance}
      duration={duration}
      fromLocation={map.fromLocation}
      toLocation={map.toLocation}
      selectedMode={map.selectedMode}
      routeOptions={map.routeOptions}
      snapPoints={snapPoints}
      onCancel={onCancel}
      onModeChange={onModeChange}
      onModeRequest={onModeRequest}
      onStart={onStart}
      // 👇 sheet swipe-down veya programatik kapanışta da aynı temizlik çalışsın
      onClose={onCancel}
      enablePanDownToClose
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClosePress} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </RouteInfoSheet>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  closeButton: { padding: 8 },
  closeText: { fontSize: 18, fontWeight: 'bold', color: '#666' },
});

export default RouteInfoSheetContainer;
