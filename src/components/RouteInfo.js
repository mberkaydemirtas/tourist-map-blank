// src/components/RouteInfo.js

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function RouteInfo({ info, onDraw }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        🕒 {info.duration}   📏 {info.distance}
      </Text>
      <TouchableOpacity onPress={onDraw} style={styles.button}>
        <Text style={styles.buttonText}>Rota Çiz</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 5,
  },
  text: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#4285F4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
