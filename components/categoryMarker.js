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
  // Koordinatları güvenli şekilde al
  const coordinate =
    item.coords ??
    item.coordinate ??
    (item.geometry?.location && {
      latitude: item.geometry.location.lat,
      longitude: item.geometry.location.lng,
    });
  if (!coordinate) return null;

  // iconKey: aktif kategori varsa; değilse item.types içinde uygun bir type
  let iconKey = null;
  if (activeCategory && ICONS[activeCategory.toLowerCase()]) {
    iconKey = activeCategory.toLowerCase();
  } else if (Array.isArray(item.types)) {
    const found = item.types.find(type => ICONS[type.toLowerCase()]);
    iconKey = found ? found.toLowerCase() : null;
  }

  const iconSource = iconKey ? ICONS[iconKey] : null;

  return (
    <Marker
      coordinate={coordinate}
      onPress={() => onSelect(item.place_id, coordinate, item.name)}
      tracksViewChanges={false}   // performansı sabitle
      opacity={1}                  // tam opaklik
      anchor={{ x: 0.5, y: 1 }}
      calloutAnchor={{ x: 0.5, y: -0.5 }}
      pinColor={!iconSource ? '#FF5A5F' : undefined}  // fallback pin rengi
      zIndex={iconSource && iconKey === activeCategory?.toLowerCase() ? 10 : 1}
    >
      {iconSource && (
        <Image
          source={iconSource}
          style={{ width: iconSize, height: iconSize, resizeMode: 'contain', opacity: 1 }}
        />
      )}
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
