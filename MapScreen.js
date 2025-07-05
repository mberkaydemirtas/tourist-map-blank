import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Linking,
  Platform,
  Text,
  TouchableOpacity
} from 'react-native';
import MapView, {
  Marker,
  Callout,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import SearchBar from './components/SearchBar/SearchBar';
import { useLocation } from './src/hooks/useLocation';
import { getPlaceDetails, getDirections } from './services/maps';
import polyline from './utils/polyline';

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

  const { coords, available } = useLocation(
    (newCoords) => {
      // Sadece GPS kullanılabiliyorsa auto-center
      const r = {
        latitude: newCoords.latitude,
        longitude: newCoords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(r);
      mapRef.current?.animateToRegion(r, 500);
    },
    () => {
      /* konum sağlanamadığında sessizce devam et */
    },
    () => {
      /* kalıcı izin reddinde sessiz devam */
    }
  );

  // Eğer location available değilse, region'i değiştirmiyoruz
  useEffect(() => {
    if (available && coords) {
      setRegion({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  }, [available, coords]);

  const handleSelectPlace = async (placeId, description) => {
    const details = await getPlaceDetails(placeId);
    if (!details) return;
    const { coord, name, address, website } = details;
    setMarker({ coordinate: coord, name, address, website });

    const destRegion = {
      latitude: coord.latitude,
      longitude: coord.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    };
    setRegion(destRegion);
    mapRef.current?.animateToRegion(destRegion, 500);

    // Rota çizimi GPS olmasa da seçime dayalı çalışır
    const origin = available && coords
      ? { latitude: coords.latitude, longitude: coords.longitude }
      : { latitude: region.latitude, longitude: region.longitude };

    const route = await getDirections(origin, coord);
    if (route?.overview_polyline) {
      const points = polyline.decode(route.overview_polyline.points);
      setRouteCoords(points.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
    }
  };

  return (
    <View style={styles.container}>
      {/* GPS veya izin yoksa bilgi banner'ı */}
      {!available && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Konum kapalı—haritayı arama ile kullanabilirsiniz.
          </Text>
          <TouchableOpacity
            onPress={() => {
              /* İstersen konum ayarlarını açma yönlendirmesi koyabilirsin */
            }}
          >
            <Text style={styles.bannerLink}>Ayarları Aç</Text>
          </TouchableOpacity>
        </View>
      )}

      <SearchBar onSelect={handleSelectPlace} />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation={available}
        onPress={() => setMarker(null)}
      >
        {marker && (
          <Marker coordinate={marker.coordinate}>
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{marker.name}</Text>
                {marker.address && <Text>{marker.address}</Text>}
                {marker.website && (
                  <Text
                    style={styles.link}
                    onPress={() => Linking.openURL(marker.website)}
                  >
                    Web Sitesini Aç
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
  bannerLink: { color: '#4da6ff', marginLeft: 12, fontWeight: 'bold' },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
});
