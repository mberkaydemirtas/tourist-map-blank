import React from 'react';
import { TouchableOpacity, StyleSheet, View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function AddStopButton({ onPress }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.fab} onPress={onPress} activeOpacity={0.9}>
        <MaterialIcons name="add-location-alt" size={20} color="#fff" />
        <Text style={styles.label}>Durak Ekle</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', right: 16, bottom: 140 },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0B72E7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 28,
    elevation: 4,
  },
  label: { color: '#fff', fontWeight: '600' },
});
