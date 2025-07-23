// src/MapScreen.js
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Portal } from 'react-native-portalize';

import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import MapMarkers from './components/MapMarkers';
import MapRoutePolyline from './components/MapRoutePolyline';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import PlaceDetailSheet from './components/PlaceDetailSheet';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';
import RouteInfoSheet from './components/RouteInfoSheet';

import { getRoute, decodePolyline } from './services/maps';

export default function MapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);
  const lastAvailable = useRef(false);

  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();

  const [isSelectingFrom, setIsSelectingFrom] = useState(false);
  const [fromSource, setFromSource] = useState(route.params?.fromSource || null);
  const [toLocation, setToLocation] = useState(route.params?.to || null);
  const [mode, setMode] = useState(route.params?.mode || 'explore');
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isSelecting, setIsSelecting] = useState(null);

  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);

  useEffect(() => {
    if (mode !== 'route' && map.marker) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [map.marker, mode]);

  useEffect(() => {
    if (!lastAvailable.current && available && coords && mapRef.current) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      requestAnimationFrame(() => {
        map.setRegion(region);
        mapRef.current.animateToRegion(region, 500);
      });
    }
    lastAvailable.current = available;
  }, [available, coords]);

  useEffect(() => {
    (async () => {
      if (mode !== 'route') return;
      const origin = fromSource?.key === 'current' ? coords : fromSource?.coords;
      if (!origin || !toLocation?.coords) return;
      try {
        const r = await getRoute(origin, toLocation.coords);
        setRouteCoords(decodePolyline(r.polyline));
        setRouteInfo({ distance: r.distance, duration: r.duration });
        requestAnimationFrame(() => sheetRefRoute.current?.snapToIndex(0));
      } catch {
        setRouteCoords([]);
        setRouteInfo(null);
      }
    })();
  }, [mode, fromSource, toLocation, coords]);

  const onGetDirectionsPress = () => {
    sheetRef.current?.close();
    setIsSelectingFrom(true);
  };

  const handleFromSelected = (src) => {
    setIsSelectingFrom(false);
    setFromSource(src);
    if (map.marker) {
      setToLocation({ description: map.marker.name, coords: map.marker.coordinate });
      setMode('route');
    }
  };

  const handleCancelRoute = () => {
    setMode('explore');
    setToLocation(null);
    setRouteCoords([]);
    setRouteInfo(null);
    sheetRefRoute.current?.close();
  };

  const handleSelectPlace = (type) => {
    setIsSelecting(type);
    navigation.navigate('PlaceSearchOverlay', {
      onPlaceSelected: (place) => {
        setIsSelecting(null);
        if (type === 'from') setFromSource(place);
        else setToLocation(place);
      },
    });
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={map.region}
        onPress={map.handleMapPress}
        onPoiClick={map.handlePoiClick}
        showsUserLocation={available}
        onPanDrag={() => map.setMapMoved(true)}
        onRegionChangeComplete={map.setRegion}
      >
        <MapMarkers
          categoryMarkers={map.categoryMarkers}
          selectedMarker={map.marker}
          activeCategory={map.activeCategory}
          onMarkerPress={map.handleMarkerSelect}
        />
        {mode === 'route' && routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#1E88E5"
            strokeWidth={5}
            lineJoin="round"
          />
        )}
      </MapView>

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {isSelectingFrom && (
          <GetDirectionsOverlay
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            onCancel={() => setIsSelectingFrom(false)}
            onFromSelected={handleFromSelected}
          />
        )}

        {mode === 'explore' && !fromSource && (
          <>
            <MapHeaderControls
              query={map.query}
              onQueryChange={map.setQuery}
              onPlaceSelect={map.handleSelectPlace}
              onCategorySelect={map.handleCategorySelect}
              mapMoved={map.mapMoved}
              loadingCategory={map.loadingCategory}
              onSearchArea={map.handleSearchThisArea}
            />
            {map.activeCategory && map.categoryMarkers.length > 0 && (
              <CategoryList
                data={map.categoryMarkers}
                activePlaceId={map.marker?.place_id}
                onSelect={map.handleSelectPlace}
                userCoords={coords}
              />
            )}
            <PlaceDetailSheet
              marker={map.marker}
              routeInfo={map.routeInfo}
              sheetRef={sheetRef}
              snapPoints={snapPoints}
              onGetDirections={onGetDirectionsPress}
            />
          </>
        )}

        {mode === 'route' && (
          <View style={styles.routeControls}>
            <Text style={styles.label}>Nereden</Text>
            <TouchableOpacity
              style={styles.inputButton}
              onPress={() => handleSelectPlace('from')}
            >
              <Text style={styles.inputText}>
                {fromSource?.description || 'Nereden'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 10 }} />

            <Text style={styles.label}>Nereye</Text>
            <TouchableOpacity
              style={styles.inputButton}
              onPress={() => handleSelectPlace('to')}
            >
              <Text style={styles.inputText}>
                {toLocation?.description || 'Nereye'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* Portal ile üst seviyede render edilen sheet */}
      <Portal>
        {mode === 'route' && routeInfo && (
          <RouteInfoSheet
            sheetRef={sheetRefRoute}
            distance={routeInfo.distance}
            duration={routeInfo.duration}
            onCancel={handleCancelRoute}
            onStart={() => console.log('navigasyon başlasın')}
          />
        )}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  routeControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 50,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    elevation: 4,
    zIndex: 10,
  },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  inputButton: {
    height: 48,
    backgroundColor: '#f9f9f9',
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  inputText: { fontSize: 16, color: '#333' },
});
