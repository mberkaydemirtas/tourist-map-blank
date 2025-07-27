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
import MapView, { PROVIDER_GOOGLE, Polyline, Marker } from 'react-native-maps';
import MarkerCallout from './components/MarkerCallout';
import { useNavigation, useRoute } from '@react-navigation/native';
import RouteSearchBar from './components/RouteSearch';
import MapSelectionOverlay from './components/MapSelectionOverlay';
import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';

import MapMarkers from './components/MapMarkers';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import PlaceDetailSheet from './components/PlaceDetailSheet';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';
import RouteInfoSheet from './components/RouteInfoSheet';

import { getRoute, decodePolyline, reverseGeocode } from './services/maps';

export default function MapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);
  const lastAvailable = useRef(false);

  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();

  // --- FLAGS FOR “GET DIRECTIONS” FLOW ---
  // Overlay’de “Konumunuz / Başka Yer / Haritadan Seç”
  const [showFromOverlay, setShowFromOverlay] = useState(false);
  // Gerçekten haritaya dokunup origin seçeceğimiz an
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);

  // --- FROM & TO & MODE STATE ---
  const [fromSource, setFromSource] = useState(null);
  const [toLocation, setToLocation] = useState(null);
  const [mode, setMode] = useState('explore'); // 'explore' | 'route'

  // --- ROUTE & INFO ---
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);

  // --- EXPLORE DETAIL SHEET ---
  useEffect(() => {
    if (map.marker && mode === 'explore') sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [map.marker, mode]);

  // --- INITIAL ZOOM TO USER ---
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

  // --- ROUTE CALCULATION WHEN MODE==='route' ---
  useEffect(() => {
  if (mode !== 'route') return;

  const origin = fromSource.key === 'current' ? coords : fromSource.coords;
  if (!origin || !toLocation?.coords) return;

  (async () => {
    try {
      const r = await getRoute(origin, toLocation.coords);
      console.log('▶️ raw route objesi:', r);

      const decoded = decodePolyline(r.polyline);
      console.log('🟢 Decode edilen rota noktaları:', decoded.length);
      setRouteCoords(decoded);
      mapRef.current?.fitToCoordinates(decoded, {
  edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
  animated: true,
});
      console.log('✅ Polyline state set edildi:', decoded.length);

      setRouteInfo({ distance: r.distance, duration: r.duration });
    } catch (e) {
      console.warn('⚠️ Route parse hatası:', e);
      setRouteCoords([]);
      setRouteInfo(null);
    }
  })();
}, [mode, fromSource, toLocation, coords]);

useEffect(() => {
  if (routeCoords.length > 0 && mapRef.current) {
    mapRef.current.fitToCoordinates(routeCoords, {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    });
  }
}, [routeCoords]);



  // --- AUTOMATICALLY OPEN ROUTE INFO SHEET ---
  useEffect(() => {
    if (mode === 'route' && routeInfo && sheetRefRoute.current) {
      sheetRefRoute.current.snapToIndex(0);
    }
  }, [mode, routeInfo]);

  // “Get Directions” butonuna basıldığında ilk adım: overlay aç
  const onGetDirectionsPress = () => {
    sheetRef.current?.close();
    setShowFromOverlay(true);
  };

  // Overlay’den “Konumunuz” veya “Arama” geldiğinde:
  const handleFromSelected = async (src) => {
  setShowFromOverlay(false);
  setFromSource(src);

  // seçeneklere göre toLocation'ı ayarla
  if (!toLocation && map.marker) {
    setToLocation({ coords: map.marker.coordinate, description: map.marker.name });
  }

  setMode('route');

  // marker detaylarını yükle ve zoom yap
  const coord = src.coords;
  await map.fetchAndSetMarker(null, coord, src.description);
  mapRef.current?.animateToRegion({ ...coord, latitudeDelta:0.01, longitudeDelta:0.01 }, 500);
};



  // Overlay’den “Haritadan Seç”e basıldığında:
  const handleMapSelect = () => {
   setShowFromOverlay(false);
   setIsSelectingFromOnMap(true);
  };

  // Haritaya dokununca, gerçek origin seçim:
    const handleSelectOriginOnMap = async (coordinate) => {
   setIsSelectingFromOnMap(false);
   try {
     // 1) reverse geocode ile adres al
     const geo = await reverseGeocode(coordinate);
     const address = geo[0]?.formatted_address || 'Seçilen Konum';
     // 2) handleFromSelected ile route-akışını başlat
     handleFromSelected({
       coords: coordinate,
       description: address,
       key: 'map'
     });
     // 3) overlay’ı kapatıp, otomatik olarak rota ekranı açılacak
   } catch (err) {
     console.warn('⚠️ Haritadan seçim hatası:', err);
   }
 };


  // MapView onPress’i: önce harita-seç moduna bak
  const handleMapPress = (e) => {
  console.log('🟡 handleMapPress tetiklendi!');
  if (isSelectingFromOnMap) {
  handleSelectOriginOnMap(e.nativeEvent.coordinate);
  return; // Burada çık!
  } else {
    map.handleMapPress(e);
    // 💡 Eğer route modundaysak ve fromSource zaten varsa, haritaya tıklanan yeri destination yap
    if (mode === 'route' && fromSource) {
      const coordinate = e.nativeEvent.coordinate;
      reverseGeocode(coordinate).then(geo => {
        const address = geo[0].formatted_address;
        setToLocation({
          coords: coordinate,
          description: address,
        });
      });
    }
  }
};


  // Route iptali
  const handleCancelRoute = () => {
    setMode('explore');
    setFromSource(null);
    setToLocation(null);
    setRouteCoords([]);
    setRouteInfo(null);
    sheetRefRoute.current?.dismiss();
  };

return (
  <View style={styles.container}>
    {console.log('🔄 RENDER DURUMU:', {
      mode,
      hasFrom: Boolean(fromSource),
      hasTo: Boolean(toLocation),
      routeCoordsLength: routeCoords.length,
    })}
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={styles.map}
      initialRegion={map.region}
      onPress={handleMapPress}
      scrollEnabled={!isSelectingFromOnMap}
      zoomEnabled={!isSelectingFromOnMap}
      rotateEnabled={!isSelectingFromOnMap}
      pitchEnabled={!isSelectingFromOnMap}
      onPoiClick={map.handlePoiClick}
      pointerEvents="auto"
      showsUserLocation={available}
      onPanDrag={() => map.setMapMoved(true)}
      onRegionChangeComplete={map.setRegion}
    >
      {/* EXPLORE CATEGORY & DETAIL MARKERS */}
      <MapMarkers
        categoryMarkers={map.categoryMarkers}
        activeCategory={map.activeCategory}
        onMarkerPress={(placeId, coordinate, name) =>
          map.handleMarkerSelect(placeId, coordinate, name)
        }
        fromSource={fromSource}
      />

      {!map.activeCategory && mode === 'explore' && map.marker?.coordinate && (
        <Marker
          coordinate={map.marker.coordinate}
          pinColor="#FF5A5F"
          tracksViewChanges={false}
          onPress={() =>
            map.handleMarkerSelect(
              map.marker.place_id,
              map.marker.coordinate,
              map.marker.name
            )
          }
        >
          <MarkerCallout marker={map.marker} />
        </Marker>
      )}

      {mode === 'route' && fromSource?.coords && (
        <Marker coordinate={fromSource.coords} pinColor="blue" />
      )}

      {mode === 'route' && toLocation?.coords && (
        <Marker
          coordinate={toLocation.coords}
          pinColor="#FF5A5F"
          tracksViewChanges={false}
        />
      )}

      {mode === 'route' && routeCoords.length > 0 && (
        <Polyline
          coordinates={routeCoords}
          strokeColor="#1E88E5"
          strokeWidth={5}
          lineJoin="round"
        />
      )}
    </MapView>

    {/* --- HARİTA SEÇİM OVERLAY’İ (tek bir yerde) --- */}
    {isSelectingFromOnMap && (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <MapSelectionOverlay onCancel={() => setIsSelectingFromOnMap(false)} />
      </View>
    )}

    <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* 1) EXPLORE MODE CONTROLS */}
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

      {/* 2) GET DIRECTIONS OVERLAY */}
      {showFromOverlay && (
        <GetDirectionsOverlay
          visible={showFromOverlay}
          userCoords={coords}
          available={available}
          refreshLocation={refreshLocation}
          historyKey="search_history"
          favoritesKey="favorite_places"
          onCancel={() => setShowFromOverlay(false)}
          onFromSelected={handleFromSelected}
          onMapSelect={handleMapSelect}
        />
      )}

      {/* 3) ROUTE MODE CONTROLS */}
      {mode === 'route' && fromSource && toLocation && (
        <>
          <View style={styles.routeControls}>
            <Text style={styles.label}>Nereden</Text>
            <RouteSearchBar
              placeholder="Konum seçin"
              value={fromSource?.description}
            />

            <View style={{ height: 10 }} />

            <Text style={styles.label}>Nereye</Text>
            <TouchableOpacity
              style={styles.inputButton}
              onPress={() =>
                navigation.navigate('PlaceSearchOverlay', {
                  onPlaceSelected: (place) => setToLocation(place),
                })
              }
            >
              <Text style={styles.inputText}>
                {toLocation?.description}
              </Text>
            </TouchableOpacity>
          </View>

          <RouteInfoSheet
            sheetRef={sheetRefRoute}
            distance={routeInfo?.distance}
            duration={routeInfo?.duration}
            onCancel={handleCancelRoute}
            onStart={() => console.log('Navigasyonu başlat')}
          />
        </>
      )}

      {/* 4) GENERAL OVERLAYS (GPS, RECENTER) */}
      <MapOverlays
        available={available}
        coords={coords}
        onRetry={refreshLocation}
        onRecenter={(region) => {
          map.setRegion(region)
          mapRef.current?.animateToRegion(region, 500)
        }}
      />
    </SafeAreaView>
  </View>
)
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
    //zIndex: 10,
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
