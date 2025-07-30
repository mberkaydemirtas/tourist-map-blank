// components/LocationButton.js
import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function LocationButton({ onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, style]} // dışarıdan gelen style'ı uygula
      activeOpacity={0.8}
    >
      <MaterialIcons name="my-location" size={24} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    top: 200,
    backgroundColor: '#4285F4',
    padding: 12,
    borderRadius: 32,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    zIndex: 999,
  },
});
