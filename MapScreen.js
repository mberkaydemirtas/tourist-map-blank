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
  // origin: eğer “current” seçilmişse coords, değilse fromSource.coords
  const origin = fromSource.key === 'current' ? coords : fromSource.coords;
  if (!origin || !toLocation?.coords) return;

  (async () => {
    try {
      // Directions API çağrısı
      const r = await getRoute(origin, toLocation.coords);
      console.log('▶️ raw route objesi:', r);

      // overview_polyline’den gelen string’i decode edip diziye çevir
      const polyStr = r.overview_polyline?.points;
      const coordsArr = polyStr ? decodePolyline(polyStr) : [];
      setRouteCoords(coordsArr);


      // legs[0] altından mesafe / süre bilgisi al
      const leg = r.legs?.[0];
      const distText = leg?.distance?.text || '';
      const durText = leg?.duration?.text || '';
      setRouteInfo({ distance: distText, duration: durText });
      console.log('▶️ routeInfo set:', { distText, durText });
    } catch (e) {
      console.warn('⚠️ Route parse hatası:', e);
      setRouteCoords([]);
      setRouteInfo(null);
    }
  })();
}, [mode, fromSource, toLocation, coords]);




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
  const handleFromSelected = (src) => {
  console.log('▶️ 4. handleFromSelected ile gelen src:', src);
  setShowFromOverlay(false);
  setFromSource(src);
  console.log('▶️ 5. fromSource state’i:', src);

  // Eğer toLocation zaten tanımlıysa dokunma
  if (toLocation) {
    console.log('⚪ Mevcut toLocation kullanılacak:', toLocation);
  }
  // Eğer marker varsa (örneğin bir yer seçilmişse), onu toLocation yap
  else if (map.marker) {
    const dest = {
      description: map.marker.name,
      coords: map.marker.coordinate,
    };
    setToLocation(dest);
    console.log('🟥 map.marker kullanılarak toLocation set edildi:', dest);
  }
  // Hiçbiri yoksa kullanıcıdan sonra nereye gideceğini seçmesini bekle
  else {
    console.log('⚠️ toLocation da map.marker da yok. Şimdilik rota çizilmeyecek.');
  }

  setMode('route');
  console.log('▶️ 7. mode set to route');
};


  // Overlay’den “Haritadan Seç”e basıldığında:
  const handleMapSelect = () => {
    setShowFromOverlay(false);
    setIsSelectingFromOnMap(true);
  };

  // Haritaya dokununca, gerçek origin seçim:
  const handleSelectOriginOnMap = async (coordinate) => {
  console.log('▶️ 1. Map’e dokundun, seçim modu:', isSelectingFromOnMap, 'coord=', coordinate);
  setIsSelectingFromOnMap(false);

  const geo = await reverseGeocode(coordinate);
  console.log('▶️ 2. reverseGeocode cevabı:', geo);

  const address = geo[0].formatted_address;

  console.log('▶️ 3. Adres çözüldü:', address);

  const src = {
  coords: coordinate,
  description: address,  // mutlaka burada description atıyoruz
  key: 'map',
  place: { name: address } // ekstra alan, ileride gerekebilir
};
console.log('🔵 [DEBUG] Oluşturulan src.description:', src.description);
  handleFromSelected(src);

    // otomatik zoom
    mapRef.current?.animateToRegion({
      ...coordinate,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 500);
  };

  // MapView onPress’i: önce harita-seç moduna bak
  const handleMapPress = (e) => {
    if (isSelectingFromOnMap) {
      handleSelectOriginOnMap(e.nativeEvent.coordinate);
    } else {
      map.handleMapPress(e);
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
      routeCoordsLength: routeCoords.length
    })}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={map.region}
        onPress={handleMapPress}
        onPoiClick={map.handlePoiClick}
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
  fromSource={fromSource} // ⭐️ buraya bunu ekle
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

        {/* ROUTE DESTINATION MARKER (KIRMIZI) */}
        {mode === 'route' && toLocation?.coords && (
          <Marker
            coordinate={toLocation.coords}
            pinColor="#FF5A5F"
            tracksViewChanges={false}
          />
        )}

        {/* ROUTE POLYLINE */}
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
                onPress={() => navigation.navigate('PlaceSearchOverlay', {
                  onPlaceSelected: place => setToLocation(place)
                })}
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
          onRecenter={region => {
            map.setRegion(region);
            mapRef.current?.animateToRegion(region, 500);
          }}
        />
      </SafeAreaView>
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
