// PlaceDetailHeader.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

export default function PlaceDetailHeader({ marker, routeInfo, onGetDirections }) {
  if (!marker) return null;

  return (
    <View style={styles.handleContainer}>
      <View style={styles.dragHandle} />
      <View style={styles.handleContent}>
        <Text style={styles.name}>{marker.name}</Text>
        <View style={styles.subHeaderRow}>
          {typeof marker.rating === 'number' && marker.googleSearchUrl && (
            <TouchableOpacity onPress={() => Linking.openURL(marker.googleSearchUrl)}>
              <Text style={styles.rating}>
                {'⭐'.repeat(Math.max(0, Math.round(marker.rating)))} {marker.rating.toFixed(1)}
              </Text>
            </TouchableOpacity>
          )}
          {marker.types?.length > 0 && (
            <Text style={styles.type}>{marker.types[0].replace(/_/g, ' ')}</Text>
          )}
          {routeInfo && (
            <Text style={styles.driveTime}>
              🚗 {routeInfo.duration} · {routeInfo.distance}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.directionsButton} onPress={onGetDirections}>
          <Text style={styles.directionsText}>Get Directions</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  handleContainer: {
    paddingTop: 8,
    backgroundColor: '#fff',
  },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 8,
  },
  handleContent: {
    paddingHorizontal: 20,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#000',
  },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rating: {
    fontSize: 14,
    color: '#f1c40f',
    marginRight: 8,
  },
  type: {
    fontSize: 14,
    color: '#555',
    marginRight: 8,
  },
  driveTime: {
    fontSize: 14,
    color: '#555',
  },
  directionsButton: {
    backgroundColor: '#34A853',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  directionsText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});