// components/MapSelectionOverlay.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function MapSelectionOverlay({ onCancel }) {
  return (
    // overlay’in kendisi dokunmayı yutmasın, altındaki MapView’e geçirsin:
    <View style={styles.overlay} pointerEvents="box-none">
      <Text style={styles.instruction}>📍 Haritaya dokunarak konumu seçin</Text>

      {/* Ortadaki nişangâh */}
      <View style={styles.crosshairContainer} pointerEvents="none">
        <View style={[styles.crosshair, styles.vert]} />
        <View style={[styles.crosshair, styles.horz]} />
      </View>

      {/* İptal butonu sadece kendisi dokunuşu yakalasın */}
      <TouchableOpacity
        style={styles.cancelButton}
        onPress={onCancel}
        pointerEvents="auto"
      >
        <Text style={styles.cancelIcon}>✕</Text>
        <Text style={styles.cancelText}>İptal</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  instruction: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 20,
    fontWeight: '600',
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crosshair: {
    position: 'absolute',
    backgroundColor: '#fff',
  },
  vert: { width: 2, height: '100%' },
  horz: { height: 2, width: '100%' },
  cancelButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelIcon: {
    color: '#fff',
    fontSize: 20,
  },
  cancelText: {
    color: '#fff',
    marginLeft: 8,
    fontSize: 16,
  },
});
