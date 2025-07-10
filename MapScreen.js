// ✅ MapScreen.js — Yeni Yapıda, Eski Fonksiyonlarla Tam Uyumlu
import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import Banner from './components/Banner';
import SearchBar from './components/SearchBar';
import CategoryBar from './components/CategoryBar';
import ScanButton from './components/ScanButton';
import MarkerCallout from './components/MarkerCallout';
import RouteInfo from './components/RouteInfo';
import LocationButton from './components/LocationButton';

export default function MapScreen() {
  const mapRef = useRef(null);
  const initialMoved = useRef(false);
  const lastAvailable = useRef(false);

  const map = useMapLogic();
  const { coords, available, refreshLocation } = useLocation(
    (p) => {
      if (!initialMoved.current) {
        const region = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
        map.setRegion(region);
        mapRef.current?.animateToRegion(region, 500);
        initialMoved.current = true;
      }
    },
    () => {
      if (!initialMoved.current) {
        const region = {
          latitude: 39.925533,
          longitude: 32.866287,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        map.setRegion(region);
        mapRef.current?.animateToRegion(region, 500);
        initialMoved.current = true;
      }
    },
    null,
    (p) => {
      const region = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      map.setRegion(region);
      mapRef.current?.animateToRegion(region, 500);
    }
  );

  useEffect(() => {
    if (!lastAvailable.current && available && coords) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      map.setRegion(region);
      mapRef.current?.animateToRegion(region, 500);
    }
    lastAvailable.current = available;
  }, [available, coords]);

  return (
    <View style={styles.container}>
      {!available && <Banner available={available} onRetry={refreshLocation} />}

      <SearchBar value={map.query} onChange={map.setQuery} onSelect={map.handleSelectPlace} />
      <CategoryBar onSelect={map.handleCategorySelect} />

      {map.mapMoved && !map.loadingCategory && <ScanButton onPress={map.handleSearchThisArea} />}

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={map.region}
        showsUserLocation={available}
        onPress={map.handleMapPress}
        onPoiClick={map.handleMapPress}
        onPanDrag={() => map.setMapMoved(true)}
        onRegionChangeComplete={map.setRegion}
      >
        {/* Kategori Markerları */}
        {map.categoryMarkers.map((item) => (
          <Marker
            key={item.id}
            coordinate={item.coordinate}
            title={item.name}
            tracksViewChanges={false}
          >
            <Text style={{ fontSize: 24 }}>
              {map.activeCategory === 'cafe'
                ? '☕'
                : map.activeCategory === 'restaurant'
                ? '🍽️'
                : map.activeCategory === 'hotel'
                ? '🏨'
                : '📍'}
            </Text>
            <MarkerCallout marker={item} isCategory />
          </Marker>
        ))}

        {/* Seçili marker */}
        {map.marker?.coordinate && (
          <Marker coordinate={map.marker.coordinate} pinColor="red" tracksViewChanges={false}>
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{map.marker.name}</Text>
                <Text>{map.marker.address}</Text>
                {map.marker.website && (
                  <Text
                    style={styles.link}
                    onPress={() => Linking.openURL(map.marker.website)}
                  >
                    Web'de Aç
                  </Text>
                )}
              </View>
            </Callout>
          </Marker>
        )}

        {/* Rota çizgisi */}
        {map.routeCoords && (
          <Polyline
            coordinates={map.routeCoords}
            strokeWidth={4}
            strokeColor="#4285F4"
            lineJoin="round"
          />
        )}
      </MapView>

      {/* Rota kutusu */}
      {map.routeInfo && !map.routeDrawn && (
        <RouteInfo info={map.routeInfo} onDraw={map.handleDrawRoute} />
      )}

      {/* Konum Butonu */}
      {available && coords && (
        <LocationButton
          onPress={() => {
            const region = {
              ...coords,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            };
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
});
