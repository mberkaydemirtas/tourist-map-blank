import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
  // Markerları cache'le
  import CategoryMarker from './components/categoryMarker';
import {
  View,
  StyleSheet,
  Text,
  Linking,
  Dimensions,
  TouchableOpacity,
  Image,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import MapView, {
  Marker,
  Callout,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { GOOGLE_MAPS_API_KEY } from '@env';
import Modal from 'react-native-modal';

import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import RouteStartModal from './components/RouteStartModal';
import Banner from './components/Banner';
import SearchBar from './components/SearchBar';
import CategoryBar from './components/CategoryBar';
import ScanButton from './components/ScanButton';
import MarkerCallout from './components/MarkerCallout';
import LocationButton from './components/LocationButton';
import CategoryList from './components/CategoryList';

const { height: windowHeight } = Dimensions.get('window');

export default function MapScreen() {
  const mapRef = useRef(null);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [autocompleteVisible, setAutocompleteVisible] = useState(false);
  const [pendingDestination, setPendingDestination] = useState(null);
  const lastAvailable = useRef(false);
  const sheetRef = useRef(null);
  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);
  
  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();

  // Bottom sheet açma/kapama
  useEffect(() => {
    if (map.marker) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [map.marker]);

  // Konum izni alındığında Ankara fallback'ten kullanıcı konumuna animasyon
  useEffect(() => {
    if (!lastAvailable.current && available && coords) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      map.setRegion(region);
      mapRef.current?.animateToRegion(region, 500);
    }
    lastAvailable.current = available;
  }, [available, coords]);

  // Marker seçildiğinde animasyon
  useEffect(() => {
    const coord = map.marker?.coordinate;
    if (coord && mapRef.current?.animateToRegion) {
      const region = { ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      mapRef.current.animateToRegion(region, 500);
      map.setRegion(region);
    }
  }, [map.marker]);

  // DEBUG: Buton koşullarını ekrana yaz
  useEffect(() => {
    console.log(
      "[DEBUG] ScanButton Condition:",
      "activeCategory:", map.activeCategory,
      "mapMoved:", map.mapMoved,
      "loadingCategory:", map.loadingCategory
    );
  }, [map.activeCategory, map.mapMoved, map.loadingCategory]);

  const openWebsite = () => {
    if (map.marker?.website) Linking.openURL(map.marker.website);
  };

  const handleDirections = () => {
    if (map.marker?.coordinate) {
      setPendingDestination(map.marker.coordinate);
      setStartModalVisible(true);
    }
  };


  const Handle = useCallback(() => (
    <SafeAreaView>
      <View style={styles.handleContainer}>
        <View style={styles.dragHandle} />
        <View style={styles.handleContent}>
          <Text style={styles.name}>{map.marker?.name}</Text>
          <View style={styles.subHeaderRow}>
            {map.marker?.rating != null && map.marker?.googleSearchUrl && (
              <TouchableOpacity onPress={() => Linking.openURL(map.marker.googleSearchUrl)}>
                <Text style={styles.rating}>
                  {'⭐'.repeat(Math.round(map.marker.rating))} {map.marker.rating.toFixed(1)}
                </Text>
              </TouchableOpacity>
            )}
            {map.marker?.types?.length > 0 && (
              <Text style={styles.type}>{map.marker.types[0].replace(/_/g, ' ')}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.directionsButton} onPress={handleDirections}>
            <Text style={styles.directionsText}>Get Directions</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  ), [map.marker, map.routeInfo]);

  // Sabit callback referansı ile marker seçme
  const onMarkerPress = useCallback((placeId, coord, name) => {
    map.handleMarkerSelect(placeId, coord, name);
  }, [map.handleMarkerSelect]);

  // DEBUG: categoryMarkers array'i referans değişimini gözle
  useEffect(() => {
    console.log('[DEBUG] categoryMarkers updated:', map.categoryMarkers.map(x => x.place_id));
  }, [map.categoryMarkers]);



  const categoryMarkerElements = useMemo(() => {
    return map.categoryMarkers.map(item => (
      <CategoryMarker
        key={item.place_id}
        item={item}
        activeCategory={map.activeCategory}
        onSelect={onMarkerPress}
      />
    ));
  }, [map.categoryMarkers, onMarkerPress, map.activeCategory]);


  return (
    <View style={styles.container}>
      {!available && <Banner available={available} onRetry={refreshLocation} />}
      <SearchBar value={map.query} onChange={map.setQuery} onSelect={map.handleSelectPlace} />
      <CategoryBar onSelect={map.handleCategorySelect} />

      {/* DEBUG: Görsel olarak da koşul yaz */}
      <Text style={{ position: 'absolute', top: 48, left: 10, zIndex: 10, backgroundColor: 'white', fontSize: 12 }}>
        [Debug]
        activeCategory: {String(map.activeCategory)} | 
        mapMoved: {String(map.mapMoved)} | 
        loadingCategory: {String(map.loadingCategory)}
      </Text>

      {map.activeCategory && map.mapMoved && !map.loadingCategory && (
        <ScanButton onPress={map.handleSearchThisArea} />
      )}

    <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={map.region}
        onPress={map.handleMapPress}
        onPoiClick={map.handlePoiClick}
        showsUserLocation={available}
        onPanDrag={() => {
          console.log('[DEBUG] onPanDrag fired');
          map.setMapMoved(true);
        }}
        onRegionChangeComplete={() => {
          console.log('[DEBUG] onRegionChangeComplete fired');
          // Only flag that the map has moved — don’t write state back to the map
          map.setMapMoved(true);
            }}
          >
        {categoryMarkerElements}

        {map.marker?.coordinate && (
          <Marker
            coordinate={map.marker.coordinate}
            pinColor="red"
            tracksViewChanges={true}
          >
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{map.marker.name}</Text>
                <Text>{map.marker.address}</Text>
                {map.marker.website && (
                  <Text style={styles.link} onPress={openWebsite}>Web’de Aç</Text>
                )}
              </View>
            </Callout>
          </Marker>
        )}

        {map.routeCoords && (
          <Polyline
            coordinates={map.routeCoords}
            strokeWidth={4}
            strokeColor="#4285F4"
            lineJoin="round"
          />
        )}
      </MapView>

      {map.categoryMarkers.length > 0 && (
      <CategoryList
        data={map.categoryMarkers}
        activePlaceId={map.marker?.place_id}
        onSelect={map.handleMarkerSelect}
        userCoords={coords}
      />

      )}

      {available && coords && (
        <LocationButton
          onPress={() => {
            const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
          style={styles.locationButton}
        />
      )}

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableContentPanningGesture={false}
        enableHandlePanningGesture
        handleComponent={Handle}
      >
      <RouteStartModal
        visible={startModalVisible}
        onClose={() => setStartModalVisible(false)}
        onSelect={(startCoord) => {
          setStartModalVisible(false);
          if (startCoord && pendingDestination) {
            map.getRouteBetween(startCoord, pendingDestination);
          }
        }}
        onSelectOther={() => {
          setStartModalVisible(false);
          setAutocompleteVisible(true);
        }}
      />
          <Modal isVisible={autocompleteVisible} style={{ margin: 0 }}>
          <View style={{ flex: 1, backgroundColor: 'white', paddingTop: 60 }}>
            <GooglePlacesAutocomplete
              placeholder="Başlangıç noktası ara..."
              predefinedPlaces={[]} // ✅ Boş array vererek hatayı önlersin
              fetchDetails
              onPress={(data, details = null) => {
                setAutocompleteVisible(false);
                if (details?.geometry?.location && pendingDestination) {
                  const coord = {
                    latitude: details.geometry.location.lat,
                    longitude: details.geometry.location.lng,
                  };
                  map.getRouteBetween(coord, pendingDestination);
                }
              }}
              query={{
                key: GOOGLE_MAPS_API_KEY,
                language: 'tr',
              }}
              enablePoweredByContainer={false}
              styles={{
                textInput: {
                  fontSize: 16,
                  backgroundColor: '#f2f2f2',
                  borderRadius: 8,
                  paddingHorizontal: 16,
                  marginHorizontal: 16,
                },
                listView: {
                  backgroundColor: 'white',
                  marginHorizontal: 16,
                },
              }}
            />

            <TouchableOpacity
              style={{
                marginTop: 20,
                alignSelf: 'center',
                padding: 12,
                backgroundColor: '#ddd',
                borderRadius: 8,
              }}
              onPress={() => setAutocompleteVisible(false)}
            >
              <Text>İptal</Text>
            </TouchableOpacity>
          </View>
        </Modal>


        <BottomSheetScrollView contentContainerStyle={styles.sheetScroll} nestedScrollEnabled>
          {map.marker?.openNow != null && (
            <Text style={[styles.status, map.marker.openNow ? styles.open : styles.closed]}>
              {map.marker.openNow ? 'Open Now' : 'Closed'}
            </Text>
          )}

          {Array.isArray(map.marker?.hoursToday) && map.marker.hoursToday.length > 0 && (
            <Text style={styles.hours}>
              {map.marker.hoursToday[(new Date().getDay() + 6) % 7]}
            </Text>
          )}

          {Array.isArray(map.marker?.photos) && map.marker.photos.length > 0 && (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.photoScroll}
            >
              {map.marker.photos.map((uri, idx) => (
                <Image key={idx} source={{ uri }} style={styles.photo} resizeMode="cover" />
              ))}
            </ScrollView>
          )}

          <View style={styles.actionsRow}>
            {map.marker?.phone && (
              <TouchableOpacity
                style={styles.callButton}
                onPress={() => Linking.openURL(`tel:${map.marker.phone}`)}
              >
                <Text style={styles.callText}>Call</Text>
              </TouchableOpacity>
            )}
            {map.marker?.website && (
              <TouchableOpacity style={styles.websiteButton} onPress={openWebsite}>
                <Text style={styles.websiteText}>Website</Text>
              </TouchableOpacity>
            )}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1, overflow: 'visible' },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
  locationButton: { position: 'absolute', top: 140, right: 20 },
  handleContainer: { paddingTop: 8, backgroundColor: '#fff' },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 8,
  },
  handleContent: { paddingHorizontal: 20 },
  sheetScroll: { padding: 20, paddingBottom: 40 },
  name: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rating: { fontSize: 14, color: '#f1c40f', marginRight: 8 },
  type: { fontSize: 14, color: '#555', marginRight: 8 },
  directionsButton: {
    backgroundColor: '#34A853',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  directionsText: { color: '#fff', fontWeight: 'bold' },
  status: { fontSize: 14, marginBottom: 12 },
  open: { color: '#0a0' },
  closed: { color: '#a00' },
  hours: { fontSize: 13, color: '#555', marginBottom: 8, marginLeft: 2 },
  photoScroll: { marginBottom: 12 },
  photo: { width: 260, height: 160, borderRadius: 12, marginRight: 10 },
  actionsRow: { flexDirection: 'row', marginTop: 8 },
  callButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  callText: { color: '#fff', fontWeight: 'bold' },
  websiteButton: {
    backgroundColor: '#777',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  websiteText: { color: '#fff', fontWeight: 'bold' },
});
