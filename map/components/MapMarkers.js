import React from 'react';
import MapView, { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Linking } from 'react-native';
import CategoryMarker from './categoryMarker';
import { normalizeCoord } from '../utils/coords';

export default function MapMarkers({ categoryMarkers, activeCategory, onMarkerPress, mode, selectedMarker }) {
   // route modda gizle
   if (mode !== 'explore') return null;
   const markers = Array.isArray(categoryMarkers) ? categoryMarkers : [];
   if (!markers.length) return null;

  // Geçersiz koordinata sahip marker'ları at
  const safeMarkers = markers.filter(item =>
    !!normalizeCoord(item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item)
  );

  return (
    <>
      {/* Kategori marker'ları */}
      {safeMarkers.map(item => {
      const coordinate = normalizeCoord(item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item);

        return (
      coordinate && (
        <CategoryMarker
          key={item.place_id || item.id}
          item={{ ...item, coordinate }}
          activeCategory={activeCategory}
          onSelect={onMarkerPress}
          iconSize={24}
        />
      )
    );
      })}

      {/* Seçilen marker için detay Callout */}
      {selectedMarker?.coordinate && (
        <Marker
          key="selected"
          coordinate={selectedMarker.coordinate}
          pinColor="red"
          tracksViewChanges={false}
        >
          <Callout tooltip>
            <View style={styles.callout}>
              <Text style={styles.title}>{selectedMarker.name}</Text>
              <Text style={styles.text}>{selectedMarker.address}</Text>
              {selectedMarker.website && (
                <Text
                  style={[styles.text, styles.link]}
                  onPress={() => Linking.openURL(selectedMarker.website)}
                >
                  Web&apos;de Aç
                </Text>
              )}
            </View>
          </Callout>
        </Marker>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  callout: {
    width: 200,
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 6,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#000',
  },
  text: {
    color: '#000',
  },
  link: {
    color: '#4285F4',
    textDecorationLine: 'underline',
    marginTop: 4,
  },
});
