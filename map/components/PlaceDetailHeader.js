// PlaceDetailHeader.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

export default function PlaceDetailHeader({
  marker,
  routeInfo,
  onGetDirections,
  ctaLabel = 'Yol Tarifi Al', // ← dışarıdan override edilebilir
}) {
  if (!marker) return null;

  const hasRating = typeof marker.rating === 'number';
  const ratingText = hasRating ? `${'⭐'.repeat(Math.max(0, Math.round(marker.rating)))} ${marker.rating.toFixed(1)}` : null;

  return (
    <View style={styles.handleContainer}>
      <View style={styles.dragHandle} />
      <View style={styles.handleContent}>
        <Text style={styles.name}>{marker.name || 'Seçilen Yer'}</Text>

        <View style={styles.subHeaderRow}>
          {hasRating && marker.googleSearchUrl ? (
            <TouchableOpacity onPress={() => Linking.openURL(marker.googleSearchUrl)}>
              <Text style={styles.rating}>{ratingText}</Text>
            </TouchableOpacity>
          ) : hasRating ? (
            <Text style={styles.rating}>{ratingText}</Text>
          ) : null}

          {marker.types?.length > 0 && (
            <Text style={styles.type}>{String(marker.types[0]).replace(/_/g, ' ')}</Text>
          )}

          {routeInfo && (routeInfo.duration || routeInfo.distance) && (
            <Text style={styles.driveTime}>
              🚗 {routeInfo.duration ?? ''}{routeInfo.duration && routeInfo.distance ? ' · ' : ''}{routeInfo.distance ?? ''}
            </Text>
          )}
        </View>

        {!!onGetDirections && (
          <TouchableOpacity style={styles.directionsButton} onPress={onGetDirections}>
            <Text style={styles.directionsText}>{ctaLabel}</Text>
          </TouchableOpacity>
        )}
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
    flexWrap: 'wrap',
    gap: 8,
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
    textTransform: 'capitalize',
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
