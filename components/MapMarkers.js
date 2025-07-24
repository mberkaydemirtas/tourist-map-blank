// components/MapMarkers.js
import React from 'react';
import { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Linking } from 'react-native';
import CategoryMarker from './categoryMarker';

export default function MapMarkers({ categoryMarkers, activeCategory, onMarkerPress, fromSource, selectedMarker }) {
  // props destructure tamamlandı

  // Güvenli liste: categoryMarkers array değilse boş dizi kullan
  const markers = Array.isArray(categoryMarkers) ? categoryMarkers : [];

  return (
    <>
      {/* Kategori marker'ları sadece ikon + tıklanabilirlik için */}
      {markers.map(item => (
        <CategoryMarker
          key={item.place_id || item.id}
          item={item}
          activeCategory={activeCategory}
          onSelect={onMarkerPress}
          iconSize={24}
        />
      ))}



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
                  Web'de Aç
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
});
