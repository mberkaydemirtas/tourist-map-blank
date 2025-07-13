import React, {
  createRef,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  StyleSheet,
  Text,
  Linking,
  Dimensions,
  TouchableOpacity,
  Image,
} from 'react-native';
import MapView, {
  Marker,
  Callout,
  Polyline,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import BottomSheet, {
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { ScrollView } from 'react-native';
import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import Banner from './components/Banner';
import SearchBar from './components/SearchBar';
import CategoryBar from './components/CategoryBar';
import ScanButton from './components/ScanButton';
import MarkerCallout from './components/MarkerCallout';
import LocationButton from './components/LocationButton';

const { height: windowHeight } = Dimensions.get('window');

export default function MapScreen() {
  const mapRef = useRef(null);
  const lastAvailable = useRef(false);

  const sheetRef = createRef();
  // now includes 30%, 60%, 75%, 90%
  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);

  const map = useMapLogic();
  const { coords, available, refreshLocation } =
    useLocation(/* …callbacks… */);

  useEffect(() => {
    if (map.marker) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [map.marker]);

  useEffect(() => {
    if (!lastAvailable.current && available && coords) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      map.setRegion(region);
      mapRef.current?.animateToRegion(region, 500);
    }
    lastAvailable.current = available;
  }, [available, coords]);

  const openWebsite = () => {
    if (map.marker?.website) Linking.openURL(map.marker.website);
  };
  const handleDirections = () => {
    map.handleDrawRoute();
    sheetRef.current?.close();
  };

  // custom handle (title + subheader) that drags the sheet
  const Handle = useCallback(() => (
    <View style={styles.handleContainer}>
      <View style={styles.dragHandle} />
      <View style={styles.handleContent}>
        <Text style={styles.name}>{map.marker?.name}</Text>
        <View style={styles.subHeaderRow}>
          {map.marker?.rating != null && map.marker?.googleSearchUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(map.marker.googleSearchUrl)}
            >
              <Text style={styles.rating}>
                {'⭐'.repeat(Math.round(map.marker.rating))}{' '}
                {map.marker.rating.toFixed(1)}
              </Text>
            </TouchableOpacity>
          )}
          {map.marker?.types?.length > 0 && (
            <Text style={styles.type}>
              {map.marker.types[0].replace(/_/g, ' ')}
            </Text>
          )}
          {map.routeInfo && (
            <Text style={styles.driveTime}>
              🚗 {map.routeInfo.duration} · {map.routeInfo.distance}
            </Text>
          )}
        </View>

        {/* Get Directions button moved here */}
        <TouchableOpacity
          style={styles.directionsButton}
          onPress={handleDirections}
        >
          <Text style={styles.directionsText}>Get Directions</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [map.marker, map.routeInfo]);

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
        onPress={map.handleMapPress}
        onPoiClick={map.handlePoiClick}
        showsUserLocation={available}
        onPanDrag={() => map.setMapMoved(true)}
        onRegionChangeComplete={map.setRegion}
      >
      {map.categoryMarkers.map(item => (
        <Marker
          key={item.place_id}
          coordinate={item.coordinate}
          tracksViewChanges={false}
          onPress={() => map.handleMarkerSelect(item.place_id, item.coordinate)}
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

      {available && coords && (
        <LocationButton
          onPress={() => {
            const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
          style={{ position: 'absolute', top: 100, right: 20, zIndex: 999 }}
        />
      )}

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableContentPanningGesture={false}
        enableHandlePanningGesture={true}
        handleComponent={Handle}
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.sheetScroll}
          nestedScrollEnabled
        >
          {/* 3. Status */}
          {map.marker?.openNow != null && (
            <Text
              style={[
                styles.status,
                map.marker.openNow ? styles.open : styles.closed,
              ]}
            >
              {map.marker.openNow ? 'Open Now' : 'Closed'}
            </Text>
          )}

          {/* 4. Hours */}
          {Array.isArray(map.marker?.hoursToday) &&
            map.marker.hoursToday.length >= 1 && (
              <Text style={styles.hours}>
                {
                  map.marker.hoursToday[
                    (new Date().getDay() + 6) % 7
                  ]
                }
              </Text>
            )}

          {/* 5. Photo carousel */}
          {Array.isArray(map.marker?.photos) &&
            map.marker.photos.length > 0 && (
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                style={styles.photoScroll}
              >
                {map.marker.photos.map((uri, idx) => (
                  <Image
                    key={idx}
                    source={{ uri }}
                    style={styles.photo}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            )}

          {/* 6. Actions */}
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
              <TouchableOpacity
                style={styles.websiteButton}
                onPress={openWebsite}
              >
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
  map: { flex: 1 },
  callout: { width: 200, padding: 5 },
  title: { fontWeight: 'bold', marginBottom: 5 },
  link: { color: 'blue', textDecorationLine: 'underline', marginTop: 5 },
  locationButton: { position: 'absolute', right: 16 },

  // custom handle
  handleContainer: {
    paddingTop: 8,
    backgroundColor: '#fff',
  },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 8,
  },
  handleContent: {
    paddingHorizontal: 20,
  },

  sheetScroll: { padding: 20, paddingBottom: 40 },

  name: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rating: { fontSize: 14, color: '#f1c40f', marginRight: 8 },
  type: { fontSize: 14, color: '#555', marginRight: 8 },
  driveTime: { fontSize: 14, color: '#555' },

  status: { fontSize: 14, marginBottom: 12 },
  open: { color: '#0a0' },
  closed: { color: '#a00' },

  hours: {
    fontSize: 13,
    color: '#555',
    marginBottom: 8,
    marginLeft: 2,
  },

  photoScroll: { marginBottom: 12 },
  photo: {
    width: 260,
    height: 160,
    borderRadius: 12,
    marginRight: 10,
  },

  actionsRow: { flexDirection: 'row', marginTop: 8 },
  directionsButton: {
    backgroundColor: '#34A853',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  directionsText: { color: '#fff', fontWeight: 'bold' },
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
