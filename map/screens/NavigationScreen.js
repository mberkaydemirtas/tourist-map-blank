import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useRoute } from '@react-navigation/native';


export default function NavigationScreen() {
  const route = useRoute();
  const { from, to } = route.params;

  const routeCoordinates = [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];

  return (
    <View style={styles.container}>
      <MapboxGL.MapView style={styles.map}>
        <MapboxGL.Camera
          centerCoordinate={[from.lng, from.lat]}
          zoomLevel={13}
        />
        <MapboxGL.PointAnnotation id="from" coordinate={[from.lng, from.lat]} />
        <MapboxGL.PointAnnotation id="to" coordinate={[to.lng, to.lat]} />
        <MapboxGL.ShapeSource
          id="route"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoordinates,
            },
          }}
        >
          <MapboxGL.LineLayer id="routeLine" style={styles.routeLine} />
        </MapboxGL.ShapeSource>
      </MapboxGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  routeLine: {
    lineColor: 'blue',
    lineWidth: 5,
  },
});
