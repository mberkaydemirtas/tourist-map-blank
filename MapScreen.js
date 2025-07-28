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
import { Portal } from '@gorhom/portal';


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
  useEffect(() => {
  console.log('📣 isSelectingFromOnMap değişti:', isSelectingFromOnMap);
}, [isSelectingFromOnMap]);

  const route = useRoute();
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);
  const lastAvailable = useRef(false);
  
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayContext, setOverlayContext] = useState(null); // 'from' | 'to'
  const [showFromOverlay, setShowFromOverlay] = useState(false);

  

  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();
  const handleReverseRoute = async () => {
  if (!fromSource?.coords || !toLocation?.coords) return;

  // 1. Yerleri değiştir
  const newFrom = toLocation;
  const newTo = fromSource;
  setFromSource(newFrom);
  setToLocation(newTo);

  try {
    // 2. Rota çiz
    const r = await getRoute(newFrom.coords, newTo.coords);
    const decoded = decodePolyline(r.overview_polyline?.points || r.polyline);
    setRouteCoords(decoded);
    setRouteInfo({ distance: r.distance, duration: r.duration });

    // 3. Haritayı ortala
    mapRef.current?.fitToCoordinates(decoded, {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    });

    // 4. Sheet'i yeniden göster
    sheetRefRoute.current?.present();

  } catch (e) {
    console.warn('🚫 Reverse rota çizilemedi:', e);
  }
};


  // --- FLAGS FOR “GET DIRECTIONS” FLOW ---
  // Overlay’de “Konumunuz / Başka Yer / Haritadan Seç”
  // Gerçekten haritaya dokunup origin seçeceğimiz an
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);

  // --- FROM & TO & MODE STATE ---
  const [fromSource, setFromSource] = useState(null);
  const [toLocation, setToLocation] = useState(null);
  const [mode, setMode] = useState('explore'); // 'explore' | 'route'

  // --- ROUTE & INFO ---
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const lastSelectedRef = useRef(null);

  const snapPoints = useMemo(() => ['30%', '60%', '75%', '90%'], []);

  // --- EXPLORE DETAIL SHEET ---
  useEffect(() => {
  console.log('📦 PlaceDetailSheet useEffect:', {
    marker: map.marker,
    mode,
    fromSource
  });

  if (mode === 'explore' && !fromSource && map.marker) {
    sheetRef.current?.snapToIndex(0);
    console.log('✅ PlaceDetailSheet açıldı');
  } else {
    sheetRef.current?.close();
    console.log('❌ PlaceDetailSheet kapatıldı');
  }
}, [map.marker, mode, fromSource]);

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
  if (mode !== 'route' || !fromSource?.coords) return; 
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
  console.log('🔄 UI Durum:', { mode, routeInfo, isSelectingFromOnMap });

  if (mode === 'route' && routeInfo && sheetRefRoute.current?.present) {
    console.log('▶️ Present çağırılıyor');
    sheetRefRoute.current.present();
  } else {
    console.log('❌ Present çağrı şartları sağlanmadı');
  }
}, [mode, routeInfo, isSelectingFromOnMap]);





  // “Get Directions” butonuna basıldığında ilk adım: overlay aç
  const onGetDirectionsPress = () => {
  if (map.marker?.coordinate) {
    lastSelectedRef.current = map.marker;
  } else {
    lastSelectedRef.current = null;
  }

  sheetRef.current?.close();
  setShowFromOverlay(true);
};

  // Overlay’den “Konumunuz” veya “Arama” geldiğinde:
  // MapScreen.js içinden...
  const handleFromSelected = async (src) => {
    // --------------------------------------------------------------------------------
    // 1) Haritadan Seç tıklandıysa seçim modundan çık
    // --------------------------------------------------------------------------------
    if (src.key === 'map') {
      setShowFromOverlay(false);
      setIsSelectingFromOnMap(true);
      // not: return yok, devam ediyoruz
    } else {
      // normal akıştaysa overlay’i kapat
      setShowFromOverlay(false);
    }

  // --------------------------------------------------------------------------------
  // 2) description ve placeId belirle (reverse geocode’tan)
  // --------------------------------------------------------------------------------
  let address = src.description || 'Seçilen Konum';
  let placeId = src.key === 'map' ? null : src.key; // eğer key arama sonucuysa key==placeId geliyor

  if (src.key === 'map' && src.coords) {
    try {
      const geo = await reverseGeocode(src.coords);
      if (geo && geo[0]) {
        address = geo[0].formatted_address || address;
        placeId = geo[0].place_id || null;
      }
    } catch (e) {
      console.warn('📛 Reverse geocode alınamadı:', e);
    }
  }

  // --------------------------------------------------------------------------------
  // 3) fromSource ve mode='route' ayarlaması
  // --------------------------------------------------------------------------------
  setFromSource({ coords: src.coords, description: address, key: placeId || 'map' });
  setMode('route');

  // --------------------------------------------------------------------------------
  // 4) toLocation otomatik ataması (önceki marker’dan)
  // --------------------------------------------------------------------------------
  if (!toLocation && map.marker) {
    setToLocation({
      coords: map.marker.coordinate,
      description: map.marker.name,
    });
  }

  // --------------------------------------------------------------------------------
  // 5) Marker oluştur ve haritayı kaynak koordinata zoom et
  // --------------------------------------------------------------------------------
  try {
    if (placeId) {
      await map.fetchAndSetMarker(placeId, src.coords, address);
    } else {
      // eğer placeId yoksa fallback olarak sadece setMarker
      map.setMarker({
        name: address,
        address,
        coordinate: src.coords,
      });
    }

    mapRef.current?.animateToRegion(
      { ...src.coords, latitudeDelta: 0.05, longitudeDelta: 0.05 },
      500
    );
  } catch (e) {
    console.warn('🟥 Marker oluşturulamadı:', e);
  }
};

  // Overlay’den “Haritadan Seç”e basıldığında:
  // Overlay’den “Haritadan Seç”e basıldığında:
const handleMapSelect = () => {
  setShowFromOverlay(false);
  setMode('route');
  setFromSource(null);
  setIsSelectingFromOnMap(true); // BU SATIR VAZGEÇİLMEZ!
  if (map.marker) {
    setToLocation({
      coords: map.marker.coordinate,
      description: map.marker.name,
    });
  }
};





  // Haritaya dokununca, gerçek origin seçim:
  // MapScreen.js içindeki handleSelectOriginOnMap fonksiyonu:

const handleSelectOriginOnMap = async (coordinate) => {
  console.log('🎯 handleSelectOriginOnMap çalıştı, koordinat:', coordinate);

  try {
    // 1) Reverse geocode ile adres ve placeId al
    const geo = await reverseGeocode(coordinate);
    const address = geo[0]?.formatted_address || 'Seçilen Konum';
    const placeId = geo[0]?.place_id;

    // 2) fromSource objesini oluştur ve state’e ata
    const src = {
      coords: coordinate,
      description: address,
      key: placeId || 'selected',
    };
    setFromSource(src);
    console.log('✅ fromSource set edildi:', src);

    // 3) toLocation zaten set’li mi, yoksa mevcut marker mı hedef?
    const destination = toLocation
      || (map.marker && {
           coords: map.marker.coordinate,
           description: map.marker.name,
         });
    if (!destination) {
      console.warn('🚫 Hedef yok, rota çizilemez');
      return;
    }
    setToLocation(destination);

    // 4) Mode’u ‘route’ yap ve seçim modunu kapat
    setMode('route');
    setIsSelectingFromOnMap(false);

    // 5) Seçili noktayı marker olarak göster
    await map.fetchAndSetMarker(placeId, coordinate, address);

    // 6) Rota isteği, polyline decode ve state’e set et
    console.log('📡 getRoute() çağırılıyor…');
    const r = await getRoute(src.coords, destination.coords);
    console.log('✅ getRoute() gelen veri:', r);
    const decoded = decodePolyline(r.overview_polyline?.points || r.polyline);
    console.log('🟢 Decode edilen nokta sayısı:', decoded.length);

    setRouteCoords(decoded);
    setRouteInfo({ distance: r.distance, duration: r.duration });

    // 7) RouteInfoSheet’i aç
    sheetRefRoute.current?.present();

  } catch (err) {
    console.warn('❌ Haritadan seçim hatası:', err);
  }
};

const handleSelectDestinationOnMap = async coord => {
  const geo = await reverseGeocode(coord);
  const address = geo[0]?.formatted_address||'Seçilen Konum';
  setToLocation({ coords:coord, description:address, key:geo[0]?.place_id });
  setIsSelectingFromOnMap(false);
  map.setMarker({ coordinate:coord, name:address, address });
  mapRef.current?.animateToRegion({ ...coord, latitudeDelta:0.01, longitudeDelta:0.01 },500);
  // rota varsa tekrar çiz:
  if (fromSource?.coords) {
    const r = await getRoute(fromSource.coords, coord);
    const pts = decodePolyline(r.overview_polyline?.points||r.polyline);
    setRouteCoords(pts);
    setRouteInfo({ distance:r.distance, duration:r.duration });
    sheetRefRoute.current?.present();
  }
};

// MapScreen.js içindeki handleMapPress fonksiyonu
const handleMapPress = (e) => {
  const { coordinate } = e.nativeEvent;

  console.log('🧭 handleMapPress', {
    mode,
    isSelectingFromOnMap,
    overlayContext,
    coordinate,
  });

  if (mode === 'route' && isSelectingFromOnMap) {
    if (overlayContext === 'from') {
      console.log('📍 Selecting FROM on map');
      handleSelectOriginOnMap(coordinate);
    } else if (overlayContext === 'to') {
      console.log('🎯 Selecting TO on map');
      handleSelectDestinationOnMap(coordinate);
    }
    
  }

  map.handleMapPress(e);
};


  // Route iptali
  const handleCancelRoute = () => {
  // 1) Keşif moduna dön
  setMode('explore');

  // 2) Eğer yedeklenmiş bir marker varsa geri yükle
  if (lastSelectedRef.current) {
    console.log('🔁 İptal sonrası marker yüklendi:', lastSelectedRef.current);
    map.setMarker(lastSelectedRef.current);

    // 3) Haritayı marker’ın olduğu bölgeye kaydır
    if (lastSelectedRef.current.coordinate) {
      mapRef.current?.animateToRegion({
        ...lastSelectedRef.current.coordinate,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }

    // 4) 📢 Detay kartını (PlaceDetailSheet) yeniden aç
    setTimeout(() => {
      if (sheetRef.current?.snapToIndex) {
        sheetRef.current.snapToIndex(0);
      }
    }, 150); // Küçük gecikme ile geç render’ı garanti eder
  } else {
    console.log('⚠️ İptalde yüklenebilecek marker yok.');
  }

  // 5) State’leri sıfırla
  setFromSource(null);
  setToLocation(null);
  setRouteCoords([]);
  setRouteInfo(null);
  sheetRefRoute.current?.dismiss();
};


return (
  <View style={styles.container}>
    {console.log('🧭 UI STATE', { mode, fromSource, toLocation })}
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
      onPanDrag={(e) => {
        map.setMapMoved(true);
        if (isSelectingFromOnMap) {
          setIsSelectingFromOnMap(false);
        }
      }}
      scrollEnabled={!isSelectingFromOnMap}
      zoomEnabled={!isSelectingFromOnMap}
      rotateEnabled={!isSelectingFromOnMap}
      pitchEnabled={!isSelectingFromOnMap}
      onPoiClick={map.handlePoiClick}
      showsUserLocation={available}
      onRegionChangeComplete={map.setRegion}
    >
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

    {/* Haritadan Seç seçimi yapılıyorsa gösterilecek overlay */}
    {isSelectingFromOnMap && (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.transparentOverlay} pointerEvents="none" />
        <View style={styles.selectionPromptContainer} pointerEvents="none">
          <Text style={styles.selectionPromptText}>
            Haritaya dokunarak bir konum seçin
          </Text>
        </View>
      </View>
    )}

    <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* EXPLORE modundaysa */}
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

      {/* Get Directions Overlay (Nereden seçimi) */}
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

      {/* Route Modundaysa Nereden / Nereye Kontrolleri */}
      {/* Route modundaysa Nereden / Nereye Kontrolleri */}
{mode === 'route' && (
  <View style={styles.routeControls}>
    {/* ⇄ Tuşu sağ üst */}
    <TouchableOpacity
      onPress={handleReverseRoute}
      style={styles.reverseCornerButton}
    >
      <Text style={styles.reverseIcon}>⇄</Text>
    </TouchableOpacity>

    {/* Nereden */}
    <Text style={styles.label}>Nereden</Text>
    <TouchableOpacity
      style={styles.inputButton}
      onPress={() => {
        setOverlayContext('from')
        setShowOverlay(true)
      }}
    >
      <Text style={styles.inputText}>
        {fromSource?.description || 'Konum seçin'}
      </Text>
    </TouchableOpacity>

    <View style={{ height: 10 }} />

    {/* Nereye */}
    <Text style={styles.label}>Nereye</Text>
    <TouchableOpacity
      style={styles.inputButton}
      onPress={() => {
        setOverlayContext('to')
        setShowOverlay(true)
      }}
    >
      <Text style={styles.inputText}>
        {toLocation?.description || 'Nereye?'}
      </Text>
    </TouchableOpacity>
  </View>
)}


      {/* 🔄 Ortak GetDirectionsOverlay */}
      {showOverlay && (
  <GetDirectionsOverlay
    visible={showOverlay}
    userCoords={coords}
    available={available}
    refreshLocation={refreshLocation}
    historyKey={`search_history_${overlayContext}`}
    favoritesKey={`favorite_places_${overlayContext}`}
    onCancel={() => setShowOverlay(false)}
    onFromSelected={(place) => {
      if (overlayContext === 'from') handleFromSelected(place);
      else if (overlayContext === 'to') setToLocation(place);
      setShowOverlay(false);
    }}
    onMapSelect={() => {
      setShowOverlay(false);
      setIsSelectingFromOnMap(true);
      // **DİKKAT**: overlayContext değişmeyecek!
    }}
  />
)}

      <MapOverlays
  available={available}
  coords={coords}
  onRetry={refreshLocation}
  onRecenter={(region) => {
    map.setRegion(region);
    mapRef.current?.animateToRegion(region, 500);
  }}
/>

<RouteInfoSheet
  ref={sheetRefRoute}
  distance={routeInfo?.distance}
  duration={routeInfo?.duration}
  onCancel={handleCancelRoute}
  onStart={() => console.log('Navigasyonu başlat')}
  snapPoints={['30%']}
>
  <View style={styles.routeSheetHeader}>
    <TouchableOpacity
      onPress={handleCancelRoute}
      style={styles.closeButton}
    >
      <Text style={styles.closeButtonText}>✕</Text>
    </TouchableOpacity>
  </View>
</RouteInfoSheet>

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
    transparentOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)', // yarı şeffaf karartma
  },
  selectionPromptContainer: {
    position: 'absolute',
    top: '40%', // ekranda ortaya yakın
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  selectionPromptText: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
routeSheetHeader: {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  paddingHorizontal: 12,
  paddingTop: 8,
},

closeButton: {
  padding: 8,
},

closeButtonText: {
  fontSize: 18,
  fontWeight: 'bold',
  color: '#666',
},
reverseButtonWrapper: {
  alignItems: 'center',
  justifyContent: 'center',
  marginVertical: 6,
},

reverseCornerButton: {
  position: 'absolute',
  top: 8,
  right: 8,
  width: 32,
  height: 32,
  borderRadius: 16,
  backgroundColor: '#eee',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 10,
  elevation: 3,
},

reverseIcon: {
  fontSize: 18,
  fontWeight: '600',
  color: '#333',
},


});
