// src/layers/RouteLayer.js
import React from 'react';
import { View, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import MapRoutePolyline from '../components/MapRoutePolyline';

export default function RouteLayer({
  active,              // mode === 'route'
  map,
  candidateStop,       // { lat, lng, name, address? }
  onAddStopFlexible,   // (payload) => void
  onRouteSelected,     // (selected) => void
  styles,
}) {
  if (!active) return null;

  return (
    <>
      {/* From/To marker’ları */}
      {map.fromLocation?.coords && (
        <Marker coordinate={map.fromLocation.coords} pinColor="blue" />
      )}
      {map.toLocation?.coords && (
        <Marker coordinate={map.toLocation.coords} pinColor="#FF5A5F" tracksViewChanges={false} />
      )}

      {/* Waypoint marker’ları */}
      {Array.isArray(map.waypoints) &&
        map.waypoints.map((w, idx) => {
          const lat = w.lat ?? w.latitude;
          const lng = w.lng ?? w.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return (
            <Marker
              key={`wp_${idx}_${w.place_id || `${lat}_${lng}`}`}
              coordinate={{ latitude: lat, longitude: lng }}
            >
              <View style={styles.wpDotOuter}>
                <View style={styles.wpDotInner}>
                  <Text style={styles.wpNum}>{idx + 1}</Text>
                </View>
              </View>
            </Marker>
          );
        })}

      {/* Aday durak */}
      {candidateStop &&
        Number.isFinite(candidateStop.lat) &&
        Number.isFinite(candidateStop.lng) && (
          <Marker coordinate={{ latitude: candidateStop.lat, longitude: candidateStop.lng }}>
            <View style={styles.candidateDotOuter}>
              <View style={styles.candidateDotInner} />
            </View>
          </Marker>
        )}

      {/* Rota polylineleri + alternatif seçim */}
      <MapRoutePolyline
        key={map.selectedMode}
        routes={map.routeOptions[map.selectedMode] || []}
        onRouteSelect={onRouteSelected}
      />
    </>
  );
}
