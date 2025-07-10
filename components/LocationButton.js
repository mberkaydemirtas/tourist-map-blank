// src/components/LocationButton.js

import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LocationButton({ onPress }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Ionicons name="locate-outline" size={24} color="#4285F4" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: 100,
    right: 10,
    backgroundColor: '#fff',
    borderRadius: 25,
    padding: 12,
    elevation: 4,
    zIndex: 1000,
  },
});
