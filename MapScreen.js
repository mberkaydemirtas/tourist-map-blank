import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Linking,
  Dimensions,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
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

const { height: windowHeight } = Dimensions.get('window');
const SNAP_POINTS_PX = [windowHeight * 0.3, windowHeight * 0.6, windowHeight * 0.9];

export default function MapScreen() {
  const mapRef = useRef(null);
  const initialMoved = useRef(false);
  const lastAvailable = useRef(false);

  const map = useMapLogic();
  const { coords, available, refreshLocation } = useLocation(
    // onSuccess
    (p) => {
      if (!initialMoved.current) {
        const region = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
        map.setRegion(region);
        mapRef.current?.animateToRegion(region, 500);
        initialMoved.current = true;
      }
    },
    // onError: fallback to Ankara
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
    // onWatch
    (p) => {
      const region = { ...p, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      map.setRegion(region);
      mapRef.current?.animateToRegion(region, 500);
    }
  );

  // Modal visibility state
  const [showModal, setShowModal] = useState(false);

  // When marker changes, open modal
  useEffect(() => {
    if (map.marker && !map.isLoadingDetails) {
      setShowModal(true);
    }
  }, [map.marker, map.isLoadingDetails]);

  const closeModal = () => setShowModal(false);
  const openWebsite = () => {
    if (map.marker?.website) {
      Linking.openURL(map.marker.website);
    }
  };

  // Zoom when GPS becomes available
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

      <SearchBar
        value={map.query}
        onChange={map.setQuery}
        onSelect={map.handleSelectPlace}
      />
      <CategoryBar onSelect={map.handleCategorySelect} />

      {map.mapMoved && !map.loadingCategory && (
        <ScanButton onPress={map.handleSearchThisArea} />
      )}

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
        {map.categoryMarkers.map(item => (
          <Marker
            key={item.id}
            coordinate={item.coordinate}
            title={item.name}
            tracksViewChanges={false}
            onPress={() => map.handleMarkerSelect(item)}
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

        {map.marker?.coordinate && (
          <Marker
            coordinate={map.marker.coordinate}
            pinColor="red"
            tracksViewChanges={false}
          >
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.title}>{map.marker.name}</Text>
                <Text>{map.marker.address}</Text>
                {map.marker.website && (
                  <Text style={styles.link} onPress={openWebsite}>
                    Web’de Aç
                  </Text>
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

      {map.routeInfo && !map.routeDrawn && (
        <RouteInfo
          info={map.routeInfo}
          onDraw={map.handleDrawRoute}
          style={[styles.routeInfo, { bottom: SNAP_POINTS_PX[1] + 16 }]}
        />
      )}
      {available && coords && (
        <LocationButton
          onPress={() => {
            const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
          style={[styles.locationButton, { bottom: SNAP_POINTS_PX[1] + 16 }]}
        />
      )}

      {/* Slide-up Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: windowHeight * 0.6 }]}>
            <View style={styles.dragHandle} />

            {map.isLoadingDetails ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" />
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.sheetScroll}>
                <Text style={styles.name}>{map.marker?.name}</Text>
                <Text style={styles.address}>{map.marker?.address}</Text>
                {map.marker?.rating != null && (
                  <Text style={styles.rating}>⭐ {map.marker.rating}</Text>
                )}
                {map.marker?.priceLevel != null && (
                  <Text style={styles.price}>{'$'.repeat(map.marker.priceLevel)}</Text>
                )}
                {map.marker?.openNow != null && (
                  <Text style={styles.status}>
                    {map.marker.openNow ? 'Open Now' : 'Closed'}
                  </Text>
                )}
                {map.marker?.phone && (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${map.marker.phone}`)}>
                    <Text style={styles.phone}>{map.marker.phone}</Text>
                  </TouchableOpacity>
                )}
                {map.marker?.website && (
                  <TouchableOpacity style={styles.button} onPress={openWebsite}>
                    <Text style={styles.buttonText}>Visit Website</Text>
                  </TouchableOpacity>
                )}

                {/* Photo carousel */}
                {map.marker?.photos?.length > 0 && (
                  <ScrollView horizontal style={styles.photoCarousel} showsHorizontalScrollIndicator={false}>
                    {map.marker.photos.map((uri, idx) => (
                      <Image key={idx} source={{ uri }} style={styles.photo} />
                    ))}
                  </ScrollView>
                )}

                {/* Review snippet */}
                {map.marker?.reviews?.length > 0 && (
                  <View style={styles.reviewSection}>
                    <Text style={styles.reviewAuthor}>{map.marker.reviews[0].authorName}</Text>
                    <Text style={styles.reviewText}>
                      "{map.marker.reviews[0].text}"
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.closeButton} onPress={closeModal}>
              <Text style={styles.closeText}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
  routeInfo: { position: 'absolute', left: 16, right: 16 },
  locationButton: { position: 'absolute', right: 16 },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetScroll: { paddingBottom: 20 },
  loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  price: { fontSize: 14, marginVertical: 4 },
  phone: { fontSize: 14, color: '#0066cc', marginVertical: 4 },
  photoCarousel: { marginVertical: 10 },
  photo: { width: 120, height: 80, borderRadius: 8, marginRight: 8 },
  reviewSection: { marginTop: 15 },
  reviewAuthor: { fontWeight: 'bold' },
  reviewText: { fontStyle: 'italic' },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  name: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  address: { fontSize: 14, color: '#555', marginBottom: 4 },
  rating: { fontSize: 14, color: '#333', marginBottom: 4 },
  status: { fontSize: 14, marginBottom: 10, color: '#006600' },
  button: {
    backgroundColor: '#4285F4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  closeButton: { alignSelf: 'flex-end', marginTop: 8 },
  closeText: { color: '#4285F4', fontSize: 16 },
});
