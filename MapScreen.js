// src/MapScreen.js
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';

import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import MapMarkers from './components/MapMarkers';
import MapRoutePolyline from './components/MapRoutePolyline';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import PlaceDetailSheet from './components/PlaceDetailSheet';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';

export default function MapScreen() {
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const lastAvailable = useRef(false);

  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();

  const [isSelectingFrom, setIsSelectingFrom] = useState(false);
  const [fromSource, setFromSource] = useState(null);

  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);

  // Marker geldiğinde sheet aç/kapa
  useEffect(() => {
    if (map.marker) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [map.marker]);

  // İlk bölge zoom’u
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

  // “Yol Tarifi Al” butonuna basıldığında
  const onGetDirectionsPress = () => {
    sheetRef.current?.close();
    setIsSelectingFrom(true);
  };

  // GetDirectionsOverlay’den “Nereden” seçimi yapıldığında
  const handleFromSelected = (src) => {
    setIsSelectingFrom(false);
    setFromSource(src);
    if (map.marker) {
      navigation.navigate('RouteScreen', {
        fromSource: src,
        to: {
          description: map.marker.name,
          coords: map.marker.coordinate,
        },
      });
    }
  };

  return (
    <View style={styles.container}>
      {/* 1) Harita en altta */}
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
        <MapRoutePolyline routeCoords={map.routeCoords} />
      </MapView>

      {/* 2) Overlay Katmanı — kesinlikle MapView’ın üstünde */}
      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {isSelectingFrom && (
          <GetDirectionsOverlay
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey="search_history"
            favoritesKey="favorite_places"
            onCancel={() => setIsSelectingFrom(false)}
            onFromSelected={handleFromSelected}
          />
        )}

        {!fromSource && (
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

        {/* Konum uyarıları da bu katmanda */}
        <MapOverlays
          available={available}
          coords={coords}
          onRetry={refreshLocation}
          onRecenter={(region) => {
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject, // Harita tam ekran
    zIndex: 0,
  },
});
