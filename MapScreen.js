// MapScreen.js — Proje kökünde, flicker önleme ve marker yeniden çizimini engelleme
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, Linking, Alert } from 'react-native';
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import SearchBar from './components/SearchBar';
import CategoryBar from './components/CategoryBar';
import { useLocation } from './src/hooks/useLocation';
import {
  getAddressFromCoords,
  getNearbyPlaces,
  getPlaceDetails,
  getRoute,
  decodePolyline,
} from './services/maps';

export default function MapScreen() {
  const mapRef = useRef(null);
  const initialMoved = useRef(false);
  const lastAvailable = useRef(false);

  // Temel state'ler
  const [region, setRegion] = useState({
    latitude: 39.925533,
    longitude: 32.866287,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [marker, setMarker] = useState(null);
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [query, setQuery] = useState('');
  const [mapMoved, setMapMoved] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);

  // Konum callback'leri
  const onFirstCoords = useCallback(p => {
    if (!initialMoved.current) {
      const r = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 500);
      initialMoved.current = true;
    }
  }, []);

  const onFirstUnavailable = useCallback(() => {
    if (!initialMoved.current) {
      const r = {
        latitude: 39.925533,
        longitude: 32.866287,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 500);
      initialMoved.current = true;
    }
  }, []);

  const onGpsOn = useCallback(p => {
    const r = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 500);
  }, []);

  const { coords, available, refreshLocation } = useLocation(
    onFirstCoords,
    onFirstUnavailable,
    () => {},
    onGpsOn
  );

  useEffect(() => {
    if (!lastAvailable.current && available) {
      const r = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 500);
    }
    lastAvailable.current = available;
  }, [available, coords]);

  // Polyline decode ve çizme
  const handleDrawRoute = () => {
    if (!routeInfo?.polyline) return;
    setRouteCoords(decodePolyline(routeInfo.polyline));
    setRouteDrawn(true);
  };

  // SearchBar seçimi
  const handleSelectPlace = async (placeId, description) => {
    setActiveCategory(null);
    setCategoryMarkers([]);
    setMapMoved(false);
    setRouteCoords(null);
    setRouteInfo(null);
    setRouteDrawn(false);
    setQuery(description);

    try {
      const details = await getPlaceDetails(placeId);
      if (!details) throw new Error();
      const coord = details.coord;

      setMarker({
        name: details.name,
        address: details.address,
        website: details.website,
        image: details.photos.length
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${details.photos[0].photo_reference}&key=${KEY}`
          : null,
        coordinate: coord,
      });

      const newRegion = {
        ...coord,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 500);

      const origin = { latitude: 39.925533, longitude: 32.866287 };
      const route = await getRoute(origin, coord);
      setRouteInfo(route);
    } catch {
      Alert.alert('Hata', 'Seçilen yerin detayları alınamadı.');
    }
  };

  // Kategori seçimi — flicker önleme
  const handleCategorySelect = async type => {
    setActiveCategory(type);
    setQuery('');
    setMarker(null);
    setRouteCoords(null);
    setRouteInfo(null);
    setRouteDrawn(false);
    setMapMoved(false);
    setLoadingCategory(true);

    try {
      const results = await getNearbyPlaces(region, type);
      setCategoryMarkers(results);
    } catch {
      Alert.alert('Hata', 'Kategori araması başarısız oldu.');
    } finally {
      setLoadingCategory(false);
    }
  };

  // Bu bölgeyi tara — flicker önleme
  const handleSearchThisArea = async () => {
    if (!activeCategory) return;
    setLoadingCategory(true);
    try {
      const results = await getNearbyPlaces(region, activeCategory);
      setCategoryMarkers(results);
    } catch {
      Alert.alert('Hata', 'Bölge araması başarısız oldu.');
    } finally {
      setLoadingCategory(false);
      setMapMoved(false);
    }
  };

  // Harita veya POI tıklama
  const handleMapPress = async e => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const info = await getAddressFromCoords(latitude, longitude);
    if (!info) return Alert.alert('Hata', 'Konum alınamadı.');

    setActiveCategory(null);
    setCategoryMarkers([]);
    setRouteCoords(null);
    setRouteInfo(null);
    setRouteDrawn(false);
    setMapMoved(false);

    setMarker(info);
    setQuery(info.name);

    const newRegion = {
      latitude,
      longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    };
    setRegion(newRegion);
    mapRef.current?.animateToRegion(newRegion, 500);

    const origin = { latitude: 39.925533, longitude: 32.866287 };
    const route = await getRoute(origin, info.coordinate);
    setRouteInfo(route);
  };

  return (
    <View style={styles.container}>
      {!available && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Konum kapalı — arama ile kullanabilirsiniz.
          </Text>
          <TouchableOpacity onPress={refreshLocation}>
            <Text style={styles.bannerLink}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.bannerLink}>Ayarları Aç</Text>
          </TouchableOpacity>
        </View>
      )}

      <SearchBar value={query} onChange={setQuery} onSelect={handleSelectPlace} />
      <CategoryBar onSelect={handleCategorySelect} />

      {mapMoved && !loadingCategory && (
        <TouchableOpacity
          style={styles.scanButton}
          onPress={handleSearchThisArea}
        >
          <Text style={styles.scanText}>Bu bölgeyi tara</Text>
        </TouchableOpacity>
      )}

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={available}
        onPress={handleMapPress}
        onPoiClick={handleMapPress}
        onPanDrag={() => activeCategory && setMapMoved(true)}
        onRegionChangeComplete={reg => setRegion(reg)}
      >
        {categoryMarkers.map(item => (
          <Marker
            key={item.id}
            coordinate={item.coordinate}
            title={item.name}
            tracksViewChanges={false}
          >
            <Text style={{ fontSize: 24 }}>  
              {activeCategory === 'cafe'
                ? '☕'
                : activeCategory === 'restaurant'
                ? '🍽️'
                : activeCategory === 'hotel'
                ? '🏨'
                : '📍'}
            </Text>
          </Marker>
        ))}

        {marker?.coordinate && (
          <Marker
            coordinate={marker.coordinate}
            pinColor="red"
            tracksViewChanges={false}
          >
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{marker.name}</Text>
                <Text>{marker.address}</Text>
                {marker.website && (
                  <Text
                    style={styles.link}
                    onPress={() => Linking.openURL(marker.website)}
                  >
                    Web'de Aç
                  </Text>
                )}
              </View>
            </Callout>
          </Marker>
        )}

        {routeCoords && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={4}
            strokeColor="#4285F4"
            lineJoin="round"
          />
        )}
      </MapView>

      {routeInfo && !routeDrawn && (
        <View style={styles.routeBox}>
          <Text style={styles.routeText}>
            🕒 {routeInfo.duration}   📏 {routeInfo.distance}
          </Text>
          <TouchableOpacity
            onPress={handleDrawRoute}
            style={styles.routeButton}
          >
            <Text style={styles.routeButtonText}>Rota Çiz</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 0,
    right: 0,
    backgroundColor: '#333',
    padding: 8,
    zIndex: 999,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: { color: '#fff', flex: 1 },
  bannerLink: { color: '#4da6ff', fontWeight: 'bold', marginLeft: 10 },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
  routeBox: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 5,
  },
  routeText: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  routeButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  routeButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  scanButton: {
    position: 'absolute',
    top: 150,
    alignSelf: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 20,
    elevation: 4,
    zIndex: 999,
  },
  scanText: { fontWeight: 'bold', color: '#4285F4' },
})

