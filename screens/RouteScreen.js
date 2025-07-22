// src/screens/RouteScreen.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  SafeAreaView,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polyline } from 'react-native-maps';

import { useLocation } from '../hooks/useLocation';
import { getRoute, decodePolyline } from '../services/maps';

import RouteSearchBar from '../components/RouteSearch'; // doğru dosya adına dikkat

export default function RouteScreen() {
  const mapRef = useRef(null);
  const lastAvailable = useRef(false);
  const { coords, available } = useLocation();

  const [region, setRegion] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [fromSource, setFromSource] = useState({ key: 'current' });
  const [destination, setDestination] = useState(null);

  // İlk konum zoom’u
  useEffect(() => {
    if (!lastAvailable.current && available && coords) {
      const init = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setRegion(init);
      mapRef.current?.animateToRegion(init, 500);
    }
    lastAvailable.current = available;
  }, [available, coords]);

  // Rota hesaplama
  useEffect(() => {
    (async () => {
      if (!fromSource || !destination) {
        setRouteCoords([]);
        return;
      }
      const origin = fromSource.key === 'current'
        ? coords
        : fromSource.coords;
      const r = await getRoute(origin, destination.coords);
      if (r?.polyline) {
        setRouteCoords(decodePolyline(r.polyline));
      }
    })();
  }, [fromSource, destination, coords]);

  return (
    <SafeAreaView style={styles.container}>
      {/* 1) Arama Çubukları */}
      <View style={styles.searchContainer}>
        <RouteSearchBar
          placeholder="Nereden"
          value={
            fromSource.key === 'current'
              ? 'Konumunuz'
              : fromSource.description
          }
          onPlaceSelect={setFromSource}
        />
        <View style={{ height: 10 }} />
        <RouteSearchBar
          placeholder="Nereye"
          value={destination?.description || ''}
          onPlaceSelect={setDestination}
        />
      </View>

      {/* 2) Harita */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation={available}
        onRegionChangeComplete={setRegion}
      >
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#1E88E5"
            strokeWidth={5}
            lineJoin="round"
          />
        )}
      </MapView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    marginTop: Platform.OS === 'ios' ? 60 : 50,
    marginHorizontal: 12,
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    // Gölge/Elevation isteğe bağlı:
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 10, 
  },
  map: {
    flex: 1,
  },
});
