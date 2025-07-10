// src/components/CategoryBar.js

import React from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

const categories = [
  { key: 'cafe', label: '☕ Cafe' },
  { key: 'restaurant', label: '🍽️ Restoran' },
  { key: 'hotel', label: '🏨 Otel' },
];

export default function CategoryBar({ onSelect }) {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {categories.map(cat => (
          <TouchableOpacity
            key={cat.key}
            onPress={() => onSelect(cat.key)}
            style={styles.button}
          >
            <Text style={styles.text}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    zIndex: 999,
  },
  button: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  text: {
    fontSize: 16,
  },
});
