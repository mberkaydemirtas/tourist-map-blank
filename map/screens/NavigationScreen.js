import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useRoute } from '@react-navigation/native';
import { PermissionsAndroid, Platform } from 'react-native';
import { TouchableOpacity, Text } from 'react-native';
import { useEffect, useState } from 'react';
import StepInstructionsModal from '../components/StepInstructionsModal';
import { getTurnByTurnSteps } from '../services/maps'; // varsa



export default function NavigationScreen() {
  const route = useRoute();
  const { from, to } = route.params;

  const routeCoordinates = [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];

  const [locationPermission, setLocationPermission] = useState(false);
  const [steps, setSteps] = useState([]);
  const [showSteps, setShowSteps] = useState(false);
  


  useEffect(() => {
  async function requestPermission() {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      setLocationPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
    } else {
      setLocationPermission(true);
    }
  }
  requestPermission();
}, []);


  return (
  <View style={styles.container}>
    <MapboxGL.MapView style={styles.map}>
      {locationPermission && (
        <>
          <MapboxGL.UserLocation visible={true} />
          <MapboxGL.Camera
            zoomLevel={13}
            followUserLocation={true}
            followUserMode="normal"
          />
        </>
      )}

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

    {/* Adım Adım Tarif Butonu */}
    <TouchableOpacity
      onPress={async () => {
        const result = await getTurnByTurnSteps(from, to);
        setSteps(result);
        setShowSteps(true);
      }}
      style={{
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        backgroundColor: '#007AFF',
        padding: 12,
        borderRadius: 10,
        zIndex: 10,
      }}
    >
      <Text style={{ color: 'white', fontWeight: 'bold' }}>Adım Adım Tarifi Göster</Text>
    </TouchableOpacity>

    {/* Modal: Adım Listesi */}
    <StepInstructionsModal
      visible={showSteps}
      steps={steps}
      onClose={() => setShowSteps(false)}
    />
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
