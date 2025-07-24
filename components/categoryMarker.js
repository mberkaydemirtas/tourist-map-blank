// components/CategoryMarker.js
import React from 'react';
import { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Image } from 'react-native';

const ICONS = {
  cafe: require('../assets/icons/cafe.png'),
  restaurant: require('../assets/icons/restaurant.png'),
  hotel: require('../assets/icons/hotel.png'),
  // diğer kategoriler eklenebilir
};

export default function CategoryMarker({ item, onSelect, activeCategory, iconSize = 24 }) {
  const coordinate =
    item.coordinate ?? item.coords ??
    (item.geometry?.location && {
      latitude: item.geometry.location.lat,
      longitude: item.geometry.location.lng,
    });
  if (!coordinate) return null;

  const iconSource = ICONS[activeCategory];
  if (!iconSource) return null;

  return (
    <Marker
      coordinate={coordinate}
      onPress={() => onSelect(item.place_id, coordinate, item.name)}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 1 }}
      calloutAnchor={{ x: 0.5, y: -0.5 }}
    >
      <Image
        source={iconSource}
        style={{ width: iconSize, height: iconSize, resizeMode: 'contain' }}
      />
      <Callout>
        <View style={styles.calloutContainer}>
          <Text style={styles.calloutText}>{item.name}</Text>
        </View>
      </Callout>
    </Marker>
  );
}

const styles = StyleSheet.create({
  calloutContainer: {
    minWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  calloutText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    color: '#333',
  },
});
