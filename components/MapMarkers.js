import React from 'react';
import MapView, { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Linking } from 'react-native';
import CategoryMarker from './categoryMarker';

export default function MapMarkers({ categoryMarkers, activeCategory, onMarkerPress, fromSource, selectedMarker }) {
  // Güvenli liste: categoryMarkers array değilse boş dizi kullan
  const markers = Array.isArray(categoryMarkers) ? categoryMarkers : [];

  // Geçersiz koordinata sahip marker'ları at
  const safeMarkers = markers.filter(item => {
    const lat = item.coords?.latitude ?? item.coordinate?.latitude ?? item.geometry?.location?.lat;
    const lng = item.coords?.longitude ?? item.coordinate?.longitude ?? item.geometry?.location?.lng;
    return lat != null && lng != null;
  });

  return (
    <>
      {/* Kategori marker'ları */}
      {safeMarkers.map(item => {
        const latitude = item.coords?.latitude ?? item.coordinate?.latitude ?? item.geometry?.location?.lat;
        const longitude = item.coords?.longitude ?? item.coordinate?.longitude ?? item.geometry?.location?.lng;
        return (
          <CategoryMarker
            key={item.place_id || item.id}
            item={{ ...item, coordinate: { latitude, longitude } }}
            activeCategory={activeCategory}
            onSelect={onMarkerPress}
            iconSize={24}
          />
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
