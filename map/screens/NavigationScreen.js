import React, { useEffect, useState } from 'react';
import { View, StyleSheet, PermissionsAndroid, Platform, TouchableOpacity, Text } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useRoute } from '@react-navigation/native';
import * as Speech from 'expo-speech';

import StepInstructionsModal from '../components/StepInstructionsModal';
import { decodePolyline } from '../maps'; // ✅ ekledik

export default function NavigationScreen() {
  const route = useRoute();
  const { from, to, mode, polyline, steps: initialSteps } = route.params;

  const [locationPermission, setLocationPermission] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [steps, setSteps] = useState(initialSteps || []);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // ✅ Rota çizimi için polyline varsa decode et
  const routeCoordinates = polyline
    ? decodePolyline(polyline).map(coord => [coord.longitude, coord.latitude])
    : [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ];

  const getDistance = (coord1, coord2) => {
    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371e3;
    const φ1 = toRad(coord1.lat);
    const φ2 = toRad(coord2.lat);
    const Δφ = toRad(coord2.lat - coord1.lat);
    const Δλ = toRad(coord2.lng - coord1.lng);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

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

  const handleUserLocation = (location) => {
  if (!steps?.length) return;

  const step = steps[currentStepIndex];
  if (!step?.maneuver?.location) return; // 💡 Yeni güvenlik kontrolü

  const userCoords = {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
  };

  const target = {
    lat: step.maneuver.location[1],
    lng: step.maneuver.location[0],
  };

  const distance = getDistance(userCoords, target);

  if (distance < 30) {
    Speech.speak(step.maneuver.instruction);
    setCurrentStepIndex(currentStepIndex + 1);
  }
};


  return (
    <View style={styles.container}>
      <MapboxGL.MapView style={styles.map}>
        {locationPermission && (
          <>
            <MapboxGL.UserLocation
              visible={true}
              onUpdate={handleUserLocation}
            />
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
        onPress={() => {
          if (steps.length) {
            setShowSteps(true);
            Speech.speak("Navigasyon başlatıldı");
          } else {
            Speech.speak("Adım bilgisi bulunamadı.");
          }
        }}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Adım Adım Tarifi Göster</Text>
      </TouchableOpacity>

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
  button: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 10,
    zIndex: 10,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
