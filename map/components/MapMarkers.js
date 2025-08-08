import React from 'react';
import { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Linking } from 'react-native';
import CategoryMarker from './categoryMarker';
import { normalizeCoord } from '../utils/coords';

export default function MapMarkers({
  mode,
  categoryMarkers,
  activeCategory,
  onMarkerPress,        // (placeId, coord, name)
  selectedMarker,       // parent gerçekten bunu geçiriyor mu?
}) {
  // Route modda kategori marker’larını gizle
  if (mode !== 'explore') return null;

  const markers = Array.isArray(categoryMarkers) ? categoryMarkers : [];
  if (!markers.length) return null;

  return (
    <>
      {/* Kategori marker'ları */}
      {markers.map((item, idx) => {
        const coord = normalizeCoord(
          item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item
        );
        if (!coord) return null;

        const key =
          item.place_id || item.id || `${activeCategory || 'cat'}-${idx}`;
        const name = item.name || item.description || 'Yer';

        return (
          <CategoryMarker
            key={key}
            item={{ ...item, coordinate: coord }}
            activeCategory={activeCategory}
            iconSize={24}
            // CategoryMarker içinde onPress olduğunda ŞU sırayla çağırmalı:
            // onSelect(placeId, coord, name)
            onSelect={(placeId, coordinate, title) =>
              onMarkerPress?.(placeId || key, coordinate || coord, title || name)
            }
          />
        );
      })}

      {/* Seçilen marker için detay Callout (opsiyonel) */}
      {selectedMarker?.coordinate && (
        <Marker
          key="selected"
          coordinate={selectedMarker.coordinate}
          pinColor="red"
          tracksViewChanges={false}
        >
          <Callout tooltip>
            <View style={styles.callout}>
              {!!selectedMarker.name && (
                <Text style={styles.title}>{selectedMarker.name}</Text>
              )}
              {!!selectedMarker.address && (
                <Text style={styles.text}>{selectedMarker.address}</Text>
              )}
              {!!selectedMarker.website && (
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
  title: { fontWeight: 'bold', marginBottom: 4, color: '#000' },
  text: { color: '#000' },
  link: { color: '#4285F4', textDecorationLine: 'underline', marginTop: 4 },
});
