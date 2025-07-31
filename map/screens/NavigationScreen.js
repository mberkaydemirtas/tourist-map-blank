import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useRoute } from '@react-navigation/native';
import { PermissionsAndroid, Platform } from 'react-native';
import { TouchableOpacity, Text } from 'react-native';
import { useEffect, useState } from 'react';
import StepInstructionsModal from '../components/StepInstructionsModal';
import { getTurnByTurnSteps } from '../maps'; // varsa
import * as Speech from 'expo-speech';




export default function NavigationScreen() {
  const { from, to } = route.params;
  const route = useRoute();

  const routeCoordinates = [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];

  const [locationPermission, setLocationPermission] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [steps, setSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const getDistance = (coord1, coord2) => {
     const toRad = (value) => (value * Math.PI) / 180;

    const R = 6371e3; // metre
    const φ1 = toRad(coord1.lat);
    const φ2 = toRad(coord2.lat);
    const Δφ = toRad(coord2.lat - coord1.lat);
    const Δλ = toRad(coord2.lng - coord1.lng);

    const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c;
    return d; // metre
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
  if (!steps.length) return;

  const userCoords = {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
  };

  const step = steps[currentStepIndex];
  if (!step) return;

  const target = {
    lat: step.maneuver.location[1],
    lng: step.maneuver.location[0],
  };

  const distance = getDistance(userCoords, target); // aşağıda açıklanacak

  if (distance < 30) { // 30 metre içinde ise
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
            onUpdate={handleUserLocation} // 🆕 Konum güncellemesiyle yönlendirme
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
      onPress={async () => {
        const result = await getTurnByTurnSteps(from, to);
        setSteps(result);
        setShowSteps(true);
        Speech.speak("Navigasyon başlatıldı");
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
      <Text style={{ color: 'white', fontWeight: 'bold' }}>
        Adım Adım Tarifi Göster
      </Text>
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
