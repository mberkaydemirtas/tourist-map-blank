// MapScreen.js
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Linking,
  Platform,
  Text,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { GOOGLE_MAPS_API_KEY } from '@env';
import SearchBar from './components/SearchBar';
import { useLocation } from './src/hooks/useLocation';
import { getPlaceDetails, getDirections } from './services/maps';
import polyline from './utils/polyline';

// Reverse-geocode helper
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

export default function MapScreen() {
  const mapRef = useRef(null);

  const [region, setRegion] = useState({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [marker, setMarker] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [mapKey, setMapKey] = useState(0);
  const [query, setQuery] = useState('');

  const { coords, available } = useLocation(
    useCallback((newCoords) => {
      mapRef.current?.animateToRegion({
        latitude: newCoords.latitude,
        longitude: newCoords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }, []),
    () => { setMarker(null); },
    () => {}
  );

  useEffect(() => { setMapKey(k => k + 1); }, [available]);

  const handleSelectPlace = async (placeId, description) => {
    setQuery(description);
    const info = await getPlaceDetails(placeId);
    if (!info) return;
    const coord = info.coordinate;
    setMarker(info);
    mapRef.current?.animateToRegion({
      latitude: coord.latitude,
      longitude: coord.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    }, 500);
    setRegion(prev => ({ ...prev, latitude: coord.latitude, longitude: coord.longitude }));

    const origin = available && coords ? coords : coord;
    const route = await getDirections(origin, coord);
    if (route?.overview_polyline) {
      const pts = polyline.decode(route.overview_polyline.points);
      setRouteCoords(pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
    }
  };

  const handleMapPress = async e => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const info = await getAddressFromCoords(latitude, longitude);
    if (!info) return;
    setQuery(info.name);
    setMarker(info);
    mapRef.current?.animateToRegion({
      latitude,
      longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    }, 500);
    setRegion(prev => ({ ...prev, latitude, longitude }));

    const origin = available && coords ? coords : { latitude, longitude };
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
          <Text style={styles.bannerText}>
            Konum kapalı — arama ile kullanabilirsiniz.
          </Text>
          <TouchableOpacity>
            <Text style={styles.bannerLink}>Ayarları Aç</Text>
          </TouchableOpacity>
        </View>
      )}

      <SearchBar
        value={query}
        onChange={setQuery}
        onSelect={handleSelectPlace}
      />

      <MapView
        key={mapKey}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation={available}
        onPress={handleMapPress}
        onPoiClick={handleMapPress}
      >
        {marker && (
          <Marker coordinate={marker.coordinate}>
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{marker.name}</Text>
                <Text>{marker.address}</Text>
                {marker.website && (
                  <Text style={styles.link} onPress={() => Linking.openURL(marker.website)}>
                    Web'de Aç
                  </Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: { color: '#fff', flex: 1 },
  bannerLink: { color: '#4da6ff', fontWeight: 'bold' },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
});
