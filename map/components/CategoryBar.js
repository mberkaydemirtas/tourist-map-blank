import React from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';

const categories = [
  { key: 'cafe', label: '☕ Cafe' },
  { key: 'restaurant', label: '🍽️ Restoran' },
  { key: 'hotel', label: '🏨 Otel' },
];

export default function CategoryBar({ onSelect, activeCategory }) {
  console.log('🔍 Aktif Kategori:', activeCategory);

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {categories.map((cat) => {
          const isActive = cat.key === activeCategory;

          return (
            <TouchableOpacity
              key={cat.key}
              onPress={() => onSelect(isActive ? null : cat.key)} // aynı kategoriye tekrar basınca kaldır
              style={[styles.button, isActive && styles.activeButton]}
            >
              <Text style={[styles.text, isActive && styles.activeText]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#ccc',
  },

  text: {
    fontSize: 15,
    color: '#333',
  },
  activeButton: {
    backgroundColor: '#1A73E8',
    borderColor: '#0b47a1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
    transform: [{ scale: 1.05 }],
  },
  activeText: {
    color: '#fff',
    fontWeight: '600',
  },

});
