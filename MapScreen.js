// MapScreen.js
import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  Image,
  Linking,
  Platform,
} from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocation } from './useLocation';
import { GOOGLE_MAPS_API_KEY } from '@env';

export default function MapScreen() {
  const mapRef = useRef(null);

  const [region, setRegion] = useState({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [marker, setMarker] = useState(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  // 1️⃣ Watch user location
  useLocation(coords => {
    const updatedRegion = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };

    setRegion(updatedRegion);
    mapRef.current?.animateToRegion(updatedRegion, 500); // <- this line is critical
  });


  // 2️⃣ Autocomplete dropdown
  const fetchSuggestions = async input => {
    if (input.length < 2) return;
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          input
        )}&key=${GOOGLE_MAPS_API_KEY}&language=tr`
      );
      const json = await res.json();
      setSuggestions(json.status === 'OK' ? json.predictions : []);
    } catch (err) {
      console.error('Autocomplete fetch error:', err);
    }
  };

  // 3️⃣ Place details for search selection
  const getPlaceDetails = async placeId => {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,photos,website&key=${GOOGLE_MAPS_API_KEY}`
      );
      const json = await res.json();
      if (json.status !== 'OK') return null;
      const loc = json.result.geometry.location;
      return {
        name: json.result.name,
        address: json.result.formatted_address,
        website: json.result.website || null,
        image: json.result.photos?.[0]
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${
              json.result.photos[0].photo_reference
            }&key=${GOOGLE_MAPS_API_KEY}`
          : null,
        coordinate: { latitude: loc.lat, longitude: loc.lng },
      };
    } catch (err) {
      console.error('Place details error:', err);
      return null;
    }
  };

  // 4️⃣ Reverse geocode on map press
  const getAddress = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
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
    } catch (err) {
      console.error('Geocode error:', err);
      return null;
    }
  };

  // 5️⃣ When user selects from dropdown
  const selectPlace = async (placeId, description) => {
    setQuery(description);
    setSuggestions([]);
    const info = await getPlaceDetails(placeId);
    if (!info) return;
    setMarker(info);
    setRegion({
      ...info.coordinate,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    });
    mapRef.current?.animateToRegion(
      { ...info.coordinate, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta },
      500
    );
  };

  // 6️⃣ When user taps on the map
  const onMapPress = async e => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const info = await getAddress(latitude, longitude);
    if (!info) return;
    setQuery(info.name);
    setSuggestions([]);
    setMarker(info);
    setRegion({
      latitude,
      longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    });
    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta },
      500
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.autocompleteContainer}>
        <TextInput
          placeholder="Bir yer ara"
          value={query}
          onChangeText={text => {
            setQuery(text);
            fetchSuggestions(text);
          }}
          style={styles.input}
        />
        <FlatList
          data={suggestions}
          keyExtractor={item => item.place_id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => selectPlace(item.place_id, item.description)}
              style={styles.suggestionItem}
            >
              <Text>{item.description}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation
        onPress={onMapPress}
        onPoiClick={({ nativeEvent }) =>
          selectPlace(nativeEvent.placeId, nativeEvent.name)
        }
      >
        {marker && (
          <Marker coordinate={marker.coordinate}>
            <Callout>
              <View style={styles.callout}>
                {marker.name && <Text style={styles.title}>{marker.name}</Text>}
                {marker.address && <Text>{marker.address}</Text>}
                {marker.website && (
                  <Text style={styles.link} onPress={() => Linking.openURL(marker.website)}>
                    Web Sitesini Aç
                  </Text>
                )}
                {marker.image && <Image source={{ uri: marker.image }} style={styles.image} />}
              </View>
            </Callout>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  autocompleteContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: '#fff',
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#ccc',
  },
  input: {
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    paddingHorizontal: 10,
    fontSize: 16,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  callout: { width: 200 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginVertical: 5 },
  image: { width: 180, height: 90, marginTop: 5, borderRadius: 5 },
});
