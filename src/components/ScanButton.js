// src/components/ScanButton.js

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function ScanButton({ onPress }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Text style={styles.text}>Bu bölgeyi tara</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 150,
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 20,
    elevation: 4,
    zIndex: 999,
  },
  text: {
    fontWeight: 'bold',
    color: '#4285F4',
  },
});
