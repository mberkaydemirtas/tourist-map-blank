// PlaceOpeningHours.js
import React from 'react';
import { Text, StyleSheet } from 'react-native';

export default function PlaceOpeningHours({ marker }) {
  if (!marker) return null;

  const todayIndex = (new Date().getDay() + 6) % 7;
  const todayHours = Array.isArray(marker.hoursToday)
    ? marker.hoursToday[todayIndex]
    : null;

  return (
    <>
      {marker.openNow != null && (
        <Text style={[styles.status, marker.openNow ? styles.open : styles.closed]}>
          {marker.openNow ? 'Open Now' : 'Closed'}
        </Text>
      )}
      {todayHours && (
        <Text style={styles.hours}>{todayHours}</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  status: {
    fontSize: 14,
    marginBottom: 12,
  },
  open: {
    color: '#0a0',
  },
  closed: {
    color: '#a00',
  },
  hours: {
    fontSize: 13,
    color: '#555',
    marginBottom: 8,
    marginLeft: 2,
  },
});