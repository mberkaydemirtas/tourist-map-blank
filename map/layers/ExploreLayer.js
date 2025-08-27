// src/layers/ExploreLayer.js
import React from 'react';
import { Marker } from 'react-native-maps';
import MarkerCallout from '../components/MarkerCallout';
import MapMarkers from '../components/MapMarkers';

export default function ExploreLayer({
  active,            // mode === 'explore'
  map,
}) {
  if (!active) return null;

  return (
    <>
      {/* Kategori marker’ları + listeden/aramadan seçim */}
      <MapMarkers
        mode="explore"
        categoryMarkers={map.categoryMarkers}
        activeCategory={map.activeCategory}
        onMarkerPress={(placeId, coordinate, name) => {
          map.handleMarkerSelect(placeId, coordinate, name);
        }}
        fromLocation={map.fromLocation}
      />

      {/* Tek seçilmiş POI marker’ı */}
      {!map.activeCategory && map.marker?.coordinate && (
        <Marker
          coordinate={map.marker.coordinate}
          pinColor="#FF5A5F"
          tracksViewChanges={false}
          onPress={() =>
            map.handleMarkerSelect(map.marker.place_id, map.marker.coordinate, map.marker.name)
          }
        >
          <MarkerCallout marker={map.marker} />
        </Marker>
      )}
    </>
  );
}
