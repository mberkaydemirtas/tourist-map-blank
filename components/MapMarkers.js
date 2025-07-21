// components/MapMarkers.js
import React from 'react';
import { Image, Text, View, StyleSheet } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import MarkerCallout from './MarkerCallout';

export default function MapMarkers({
  categoryMarkers,
  selectedMarker,
  activeCategory,
  onMarkerPress,
}) {
  const getIcon = () => {
    switch (activeCategory) {
      case 'cafe':
        return require('../assets/icons/cafe.png');
      case 'restaurant':
        return require('../assets/icons/restaurant.png');
      case 'hotel':
        return require('../assets/icons/hotel.png');
      default:
        return null;
    }
  };

  const icon = getIcon();

  return (
    <>
      {categoryMarkers.map((item) => (
        <Marker
          key={item.place_id}
          coordinate={item.coordinate}
          tracksViewChanges={false}
          onPress={() => onMarkerPress(item.place_id, item.coordinate)}
          // Eğer ikon yoksa fallback pinColor kullan
          {...(!icon && { pinColor: '#FF5A5F' })}
        >
          {icon && <Image source={icon} style={{ width: 30, height: 30 }} />}
          <MarkerCallout marker={item} isCategory />
        </Marker>
      ))}

      {selectedMarker?.coordinate && (
        <Marker
          coordinate={selectedMarker.coordinate}
          pinColor="red"
          tracksViewChanges={false}
        >
          <Callout>
            <View style={styles.callout}>
              <Text style={styles.title}>{selectedMarker.name}</Text>
              <Text style={styles.text}>{selectedMarker.address}</Text>
              {selectedMarker.website && (
                <Text
                  style={[styles.text, styles.link]}
                  onPress={() => Linking.openURL(selectedMarker.website)}
                >
                  Web’de Aç
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
    padding: 5,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#000',
  },
  text: {
    color: '#000',
  },
  link: {
    color: 'blue',
    textDecorationLine: 'underline',
    marginTop: 5,
  },
});
