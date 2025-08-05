// components/NavigationBanner.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity,Platform } from 'react-native';

export default function NavigationBanner({ maneuver, duration, distance, onCancel }) {
  if (!maneuver) return null;

  const { instruction, distance: stepDistance, maneuverType } = maneuver;

  // Manevra tipine göre basit ikon belirle (geliştirilebilir)
  const directionEmoji = {
    turn_right: '➡️',
    turn_left: '⬅️',
    straight: '⬆️',
    roundabout: '↩️',
    depart: '🚩',
    arrive: '🏁',
  }[maneuverType] || '➡️';

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{directionEmoji}</Text>

      <View style={styles.infoContainer}>
        <Text style={styles.instruction}>{instruction}</Text>
        <Text style={styles.subText}>{stepDistance || distance} – {duration}</Text>
      </View>

      <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
        <Text style={styles.cancelText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 10,
    right: 10,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    zIndex: 999,
  },
  icon: { fontSize: 30, marginRight: 12 },
  infoContainer: { flex: 1 },
  instruction: { fontSize: 16, fontWeight: '600', color: '#333' },
  subText: { fontSize: 14, color: '#666', marginTop: 4 },
  cancelButton: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#eee',
  },
  cancelText: { fontSize: 18, fontWeight: 'bold', color: '#444' },
});
