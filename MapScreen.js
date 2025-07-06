import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, Linking, Alert } from 'react-native';
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { GOOGLE_MAPS_API_KEY } from '@env';
import SearchBar from './components/SearchBar';
import { useLocation } from './src/hooks/useLocation';
import { getDirections } from './services/maps';
import polyline from '@mapbox/polyline';

async function getAddressFromCoords(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' || !json.results.length) return null;
  const best = json.results[0];
  return {
    name: best.formatted_address,
    address: best.formatted_address,
    website: null,
    image: null,
    coordinate: { latitude: lat, longitude: lng },
  };
}

// ✅ Güvenli getPlaceDetails
async function getPlaceDetails(placeId) {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,website,photos&key=${GOOGLE_MAPS_API_KEY}`
    );
    const json = await res.json();

    if (json.status !== 'OK') {
      console.warn('Google API error:', json.status, json.error_message);
      return null;
    }

    const result = json.result;
    if (
      !result.geometry ||
      !result.geometry.location ||
      result.geometry.location.lat == null ||
      result.geometry.location.lng == null
    ) {
      console.warn('Eksik konum bilgisi:', result);
      return null;
    }

    const lat = result.geometry.location.lat;
    const lng = result.geometry.location.lng;

    return {
      name: result.name,
      address: result.formatted_address,
      website: result.website ?? null,
      image: result.photos?.length
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${result.photos[0].photo_reference}&key=${GOOGLE_MAPS_API_KEY}`
        : null,
      coordinate: { latitude: lat, longitude: lng },
    };
  } catch (e) {
    console.error('getPlaceDetails error:', e);
    return null;
  }
}

export default function MapScreen() {
  const mapRef = useRef(null);
  const initialMoved = useRef(false);
  const lastAvailable = useRef(false);

  const [region, setRegion] = useState({
    latitude: 39.925533,
    longitude: 32.866287,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [marker, setMarker] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [query, setQuery] = useState('');

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
      const r = { latitude: 39.925533, longitude: 32.866287, latitudeDelta: 0.05, longitudeDelta: 0.05 };
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
      setRegion(prev => ({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }));
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
    }
    lastAvailable.current = available;
  }, [available]);

  const handleSelectPlace = async (placeId, description) => {
    setQuery(description);
    const info = await getPlaceDetails(placeId);
    if (!info || !info.coordinate || info.coordinate.latitude == null || info.coordinate.longitude == null) {
      Alert.alert('Hata', 'Seçilen yerin konumu alınamadı. Lütfen başka bir yer deneyin.');
      return;
    }

    const coord = info.coordinate;
    setMarker(info);
    const r = { ...coord, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 500);

    const origin = available && coords ? coords : { latitude: 39.925533, longitude: 32.866287 };
    const route = await getDirections(origin, coord);
    if (route?.overview_polyline) {
      const pts = polyline.decode(route.overview_polyline.points);
      setRouteCoords(pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
    }
  };

  const handleMapPress = async e => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const info = await getAddressFromCoords(latitude, longitude);
    if (!info || !info.coordinate) {
      Alert.alert('Hata', 'Konum alınamadı.');
      return;
    }

    setQuery(info.name);
    setMarker(info);
    const r = { latitude, longitude, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 500);

    const origin = available && coords ? coords : { latitude: 39.925533, longitude: 32.866287 };
    const route = await getDirections(origin, info.coordinate);
    if (route?.overview_polyline) {
      const pts = polyline.decode(route.overview_polyline.points);
      setRouteCoords(pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
    }
  };

  return (
    <View style={styles.container}>
      {!available && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Konum kapalı — arama ile kullanabilirsiniz.</Text>
          <TouchableOpacity onPress={refreshLocation}>
            <Text style={styles.bannerLink}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.bannerLink}>Ayarları Aç</Text>
          </TouchableOpacity>
        </View>
      )}
      <SearchBar value={query} onChange={setQuery} onSelect={handleSelectPlace} />
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation={available}
        onPress={handleMapPress}
        onPoiClick={handleMapPress}
      >
        {marker?.coordinate && (
          <Marker coordinate={marker.coordinate}>
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{marker.name}</Text>
                <Text>{marker.address}</Text>
                {marker.website && (
                  <Text style={styles.link} onPress={() => Linking.openURL(marker.website)}>Web'de Aç</Text>
                )}
              </View>
            </Callout>
          </Marker>
        )}
        {routeCoords && (
          <Polyline coordinates={routeCoords} strokeWidth={4} lineJoin="round" />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 0, right: 0,
    backgroundColor: '#333',
    padding: 8,
    zIndex: 999,
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center'
  },
  bannerText: { color: '#fff', flex: 1 },
  bannerLink: { color: '#4da6ff', fontWeight: 'bold', marginLeft: 10 },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
});
