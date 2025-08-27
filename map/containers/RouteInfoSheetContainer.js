// src/containers/RouteInfoSheetContainer.js
import React, { forwardRef, useRef, useImperativeHandle } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import RouteInfoSheet from '../components/RouteInfoSheet';

const RouteInfoSheetContainer = forwardRef(function RouteInfoSheetContainer(
  { distance, duration, map, snapPoints = ['30%'], onCancel, onModeChange, onModeRequest, onStart },
  ref
) {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    snapToIndex: (i) => innerRef.current?.snapToIndex?.(i),
    expand: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    collapse: () => innerRef.current?.collapse?.(),
  }));

  return (
    <RouteInfoSheet
      ref={innerRef}
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
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
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
