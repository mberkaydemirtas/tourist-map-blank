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
import { Portal } from '@gorhom/portal';
import { useMapLogic } from './hooks/useMapLogic';


import MapMarkers from './components/MapMarkers';
import ScanButton from './components/ScanButton';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import PlaceDetailSheet from './components/PlaceDetailSheet';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';
import RouteInfoSheet from './components/RouteInfoSheet';
import NavigationBanner from './components/NavigationBanner';
import MapRoutePolyline from './components/MapRoutePolyline';


import { getRoute, decodePolyline, reverseGeocode, getPlaceDetails } from './maps';

export default function MapScreen() {
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();
  const route = useRoute();
  
  useEffect(() => {
  if (map.marker && sheetRef.current) {
    sheetRef.current.present();
  }
}, [map.marker]);

  useEffect(() => {
  console.log('📣 isSelectingFromOnMap değişti:', isSelectingFromOnMap);
}, [isSelectingFromOnMap]);

  
  
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);
  const lastAvailable = useRef(false);
  const getRouteColor = (mode) => {
  switch (mode) {
    case 'walking': return '#4CAF50'; // yeşil
    case 'transit': return '#FF9800'; // turuncu
    case 'driving': default: return '#1E88E5'; // mavi
  }
};

  
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayContext, setOverlayContext] = useState(null); // 'from' | 'to'
  const [showFromOverlay, setShowFromOverlay] = useState(false);


  
  const [canShowScan, setCanShowScan] = useState(false);
  const [mapMovedAfterDelay, setMapMovedAfterDelay] = useState(false);

  useEffect(() => {
    setCanShowScan(false);
    setMapMovedAfterDelay(false);
    if (map.activeCategory) {
      const timer = setTimeout(() => setCanShowScan(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [map.activeCategory]);

  const onRegionChangeComplete = region => {
    map.setRegion(region);
    if (canShowScan) {
      setMapMovedAfterDelay(true);
    }
  };

  const calculateRoute = async (origin, destination, selectedMode = 'driving') => {
  try {
    const route = await getRoute(origin, destination, map.selectedMode);
    if (!route) throw new Error('Rota alınamadı');

    const decoded = route.decodedCoords;
    setRouteCoords(decoded);
    setRouteInfo({ distance: route.distance, duration: route.duration });

    mapRef.current?.fitToCoordinates(decoded, {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    });
  } catch (e) {
    console.warn('⚠️ calculateRoute hata:', e);
    setRouteCoords([]);
    setRouteInfo(null);
  }
};


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



// MapScreen içindesin…
// MapScreen.js içinde, fonksiyonun en başında (state/ref tanımlarından sonra)
const prevCatCount = useRef(0);


useEffect(() => {
  if (map.categoryMarkers.length > 0) {
    // Koordinatları hazırla
    const coords = map.categoryMarkers
      .map(item => {
        const latitude = item.coords?.latitude ?? item.coordinate?.latitude ?? item.geometry?.location?.lat;
        const longitude = item.coords?.longitude ?? item.coordinate?.longitude ?? item.geometry?.location?.lng;
        return latitude && longitude ? { latitude, longitude } : null;
      })
      .filter(Boolean);

    // 500ms delay ile marker'lar render edilsin sonra fit yapalım
    if (coords.length > 0) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 100, bottom: 300, left: 100, right: 100 },
          animated: true,
        });
      }, 500);
    }
  }
}, [map.categoryMarkers]);



  // --- FLAGS FOR “GET DIRECTIONS” FLOW ---
  // Overlay’de “Konumunuz / Başka Yer / Haritadan Seç”
  // Gerçekten haritaya dokunup origin seçeceğimiz an
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);

  // --- FROM & TO & MODE STATE ---
  const [fromSource, setFromSource] = useState(null);
  const [toLocation, setToLocation] = useState(null);
  const [mode, setMode] = useState('explore'); // 'explore' | 'route'

  // --- ROUTE & INFO ---
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationStepIndex, setNavigationStepIndex] = useState(0);
  const [firstManeuver, setFirstManeuver] = useState(null);
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

  useEffect(() => {
  const route = map.routeOptions[map.selectedMode];
  if (!route || !route.decodedCoords?.length) return;

  setRouteCoords(route.decodedCoords);
  setRouteInfo({
    distance: route.distance,
    duration: route.duration,
  });

  // Sadece mod değişiminden dolayı ortalanıyorsa animasyonlu yap
  mapRef.current?.fitToCoordinates(route.decodedCoords, {
    edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
    animated: true,
  });
}, [map.selectedMode]);

  // --- ROUTE CALCULATION WHEN MODE==='route' ---
useEffect(() => {
  if (
    mode === 'route' &&
    fromSource?.coords &&
    toLocation?.coords
  ) {
    map
      .fetchAllRoutes(fromSource.coords, toLocation.coords)
      .then(() => {
        sheetRefRoute.current?.present();
      })
      .catch(err => {
        console.warn('❌ Rota hesaplama hatası:', err);
      });
  }
}, [mode, map.fromSource, map.toLocation]);

  // --- AUTOMATICALLY OPEN ROUTE INFO SHEET ---
  useEffect(() => {
    console.log('🔄 UI Durum:', { mode, routeInfo, isSelectingFromOnMap });

    if (mode === 'route' && routeInfo && sheetRefRoute.current?.present) {
      console.log('▶️ Present çağırılıyor');
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
  // 'map' veya 'current' için placeId null
  let placeId = (src.key === 'map' || src.key === 'current') 
                  ? null 
                  : src.key;

  // Eğer haritadan ya da current konumdan geldiyse, kendi koordinatını kullan
  if ((src.key === 'map' || src.key === 'current') && src.coords) {
    try {
      const geo = src.key === 'map'
        ? await reverseGeocode(src.coords)
        : null;
      if (geo?.[0]) {
        address = geo[0].formatted_address || address;
        // placeId hâlâ null
      }
    } catch (e) {
      console.warn('📛 Reverse geocode alınamadı:', e);
    }
  }

  // --------------------------------------------------------------------------------
  // 3) fromSource ve mode='route' ayarlaması
  // --------------------------------------------------------------------------------
   setFromSource({ coords: src.coords, description: address, key: src.key });
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
      // Sadece gerçek place_id ile detay iste
      await map.fetchAndSetMarker(placeId, src.coords, address);
    } else {
      // current veya map durumunda basit setMarker
      map.setMarker({
        coordinate: src.coords,
        name: address,
        address,
      });
    }
    mapRef.current?.animateToRegion(
      { ...src.coords, latitudeDelta: 0.05, longitudeDelta: 0.05 },
      500
    );
  } catch (e) {
    console.warn('🟥 Marker detay çekilemedi:', e);
  }
  };

  // Overlay’den “Haritadan Seç”e basıldığında:
  // Overlay’den “Haritadan Seç”e basıldığında:
  const handleMapSelect = () => {
    setShowFromOverlay(false);
    setMode('route');
    setOverlayContext('from'); // 🔧 EKLENDİ: seçim hangi alan için yapılıyor?
    setFromSource(null);
    setIsSelectingFromOnMap(true);
    setShowSelectionHint(true);

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
    // 1) Adres ve place_id bilgisini al
    const geo = await reverseGeocode(coordinate);
    const address = geo?.[0]?.formatted_address || '';
    const placeId = geo?.[0]?.place_id;

    // 2) Eğer place_id varsa, detaylardan place adı al
    let name = null;
    if (placeId) {
      try {
        const details = await getPlaceDetails(placeId);
        name = details.name;
      } catch (e) {
        console.warn('📛 getPlaceDetails hata:', e);
      }
    }

    // 3) Açıklama olarak önce name, yoksa address kullan
    const description = name || address || 'Seçilen Konum';

    // 4) fromSource objesini oluştur ve state’e yaz
    const fromSrc = {
      coords: coordinate,
      description,
      key: placeId || 'map',
    };
    setFromSource(fromSrc);
    console.log('✅ fromSource set edildi:', fromSrc);

    // 5) toLocation belirlenmemişse mevcut marker’dan türet
    let destination = toLocation;
    if (!destination && map.marker?.coordinate) {
      destination = {
        coords: map.marker.coordinate,
        description: map.marker.name || address,
        key: map.marker.place_id || 'map',
      };
      setToLocation(destination);
    }

    if (!destination) {
      console.warn('🚫 Rota çizimi için hedef yok');
      return;
    }

    // 6) Modu güncelle ve seçim modunu kapat
    setMode('route');
    setIsSelectingFromOnMap(false);

    // 7) Seçilen başlangıç noktasını marker olarak göster
    if (placeId) {
      await map.fetchAndSetMarker(placeId, coordinate, description);
    } else {
      map.setMarker({ coordinate, name: description, address: description });
    }

    // 8) Rota çizimi
    console.log('📡 getRoute() çağırılıyor…');
    const result = await getRoute(fromSrc.coords, destination.coords);
    const polyline = result.overview_polyline?.points || result.polyline;
    const points = decodePolyline(polyline || '');

    if (!points.length) {
      console.warn('⚠️ Polyline decode edilemedi veya boş');
      return;
    }

    console.log('🟢 Toplam çizilecek nokta:', points.length);
    setRouteCoords(points);
    setRouteInfo({
      distance: result.distance,
      duration: result.duration,
    });

    // 9) Alt bilgi kartını göster
    sheetRefRoute.current?.present();

  } catch (error) {
    console.warn('❌ Haritadan seçim hatası:', error);
  }
};

useEffect(() => {
  if (map.routeOptions && map.selectedMode) {
    const selectedRoute = map.routeOptions[map.selectedMode]?.find(r => r.isPrimary);
    if (selectedRoute?.decodedCoords) {
      setRouteCoords(selectedRoute.decodedCoords);
      setRouteInfo({
        distance: selectedRoute.distance,
        duration: selectedRoute.duration,
      });
    }
  }
}, [map.selectedMode]);

// MapScreen.js içinde, diğer useEffect’lerden birine yakın ekle:
useEffect(() => {
  // rota modu aktif ve rota çizildiğinde sheet’i aç
  if (mode === 'route' && map.routeDrawn) {
    sheetRefRoute.current?.present();
  }
}, [mode, map.routeDrawn]);


// MapScreen.js içindeki handleMapPress fonksiyonu
  const handleMapPress = (e) => {
    const { coordinate } = e.nativeEvent;

    console.log('🧪 TIKLAMA - mode:', mode, 'isSelectingFromOnMap:', isSelectingFromOnMap, 'overlayContext:', overlayContext);

    if (mode === 'route' && isSelectingFromOnMap) {
      console.log('📌 Seçim Modu Aktif! Context:', overlayContext);
      if (overlayContext === 'from') {
        console.log('📍 Başlangıç seçiliyor');
        handleSelectOriginOnMap(coordinate);
      } else if (overlayContext === 'to') {
        console.log('🎯 Hedef seçiliyor');
        handleSelectDestinationOnMap(coordinate);
      }
      return;
    }

    map.handleMapPress(e); // fallback
  };



  const handleSelectDestinationOnMap = async (coordinate) => {
  console.log('🎯 handleSelectDestinationOnMap çalıştı, koordinat:', coordinate);

  try {
    // 1) Adres ve place_id bilgisini al
    const geo = await reverseGeocode(coordinate);
    const address = geo?.[0]?.formatted_address || '';
    const placeId = geo?.[0]?.place_id;

    // 2) Eğer place_id varsa, detaylardan mekan adını al
    let name = null;
    if (placeId) {
      try {
        const details = await getPlaceDetails(placeId);
        name = details.name;
      } catch (e) {
        console.warn('📛 getPlaceDetails hata:', e);
      }
    }

    // 3) description: önce name, yoksa address
    const description = name || address || 'Seçilen Konum';

    // 4) toLocation state’ini güncelle
    setToLocation({
      coords: coordinate,
      description,
      key: placeId || 'map',
    });
    console.log('✅ toLocation set edildi:', description);

    // 5) Seçim modunu kapat
    setIsSelectingFromOnMap(false);

    // 6) Marker’ı ekle
    if (placeId) {
      // Gerçek place_id’li mekansa detaylı marker
      await map.fetchAndSetMarker(placeId, coordinate, description);
    } else {
      // “map” veya “current” gibi place_id yoksa basit marker
      map.setMarker({ coordinate, name: description, address: description });
    }

    // 7) Haritayı seçilen bölgeye kaydır
    mapRef.current?.animateToRegion(
      { ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500
    );

    // 8) Daha önce fromSource varsa rota çiz
    if (fromSource?.coords) {
      console.log('📡 getRoute() çağırılıyor (destination)…');
      const result = await getRoute(fromSource.coords, coordinate);
      const polyline = result.overview_polyline?.points || result.polyline;
      const points = decodePolyline(polyline || '');

      if (!points.length) {
        console.warn('⚠️ Polyline decode edilemedi veya boş');
      } else {
        console.log('🟢 Toplam çizilecek nokta:', points.length);
        setRouteCoords(points);
        setRouteInfo({
          distance: result.distance,
          duration: result.duration,
        });
        // 9) Alt bilgi kartını göster
        sheetRefRoute.current?.present();
      }
    }
  } catch (error) {
    console.warn('❌ handleSelectDestinationOnMap hata:', error);
  }
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
      key={`cat-${map.categoryMarkers.length}`}
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={styles.map}
      initialRegion={map.region}
      onPress={handleMapPress}
       onPanDrag={() => {
    if (showSelectionHint) {
      console.log('🛑 Kullanıcı haritayı oynattı, sadece banner gizlendi');
      setShowSelectionHint(false);
    }
    
    // İZİN VER: isSelectingFromOnMap true kalsın
  }}
      onRegionChangeComplete={onRegionChangeComplete}
      scrollEnabled={true}         // 🔓 her zaman açık
      zoomEnabled={true}           // 🔓
      rotateEnabled={true}
      pitchEnabled={true}
      onPoiClick={(e) => {
    // Seçim modundaysa POI tıklamayı origin seçimi olarak işle
    if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
      handleSelectOriginOnMap(e.nativeEvent.coordinate);
      return;
    }
    if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
      handleSelectDestinationOnMap(e.nativeEvent.coordinate);
      return;
    }
    // Aksi halde varsayılan POI davranışı (detay açma) devam etsin
    map.handlePoiClick(e, {
  showOverlay,
  showFromOverlay,
  closeOverlays: () => {
    setShowOverlay(false);
    setShowFromOverlay(false);
  },
  });
      }}
      showsUserLocation={available}
      
    >
      <MapMarkers
  categoryMarkers={map.categoryMarkers}
  activeCategory={map.activeCategory}
  onMarkerPress={(placeId, coordinate, name) => {
    if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
      // Nereden için seçiliyorsa
      handleSelectOriginOnMap(coordinate);
    } else if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
      // Nereye için seçiliyorsa
      handleSelectDestinationOnMap(coordinate);
    } else {
      // Normal keşif akışı
      map.handleMarkerSelect(placeId, coordinate, name);
    }
  }}
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

      <MapRoutePolyline
       key={map.selectedMode}              // mod değişince yeniden render etmesi için
       routes={map.routeOptions[map.selectedMode] || []}
  onRouteSelect={(selected) => {
    const updated = (map.routeOptions[map.selectedMode] || []).map(r => ({
      ...r,
      isPrimary: r.id === selected.id,
    }));

    map.setRouteOptions(prev => ({
      ...prev,
      [map.selectedMode]: updated,
    }));

    setRouteCoords(selected.decodedCoords);
    setRouteInfo({
      distance: selected.distance,
      duration: selected.duration,
    });

    mapRef.current?.fitToCoordinates(selected.decodedCoords, {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    });

    sheetRefRoute.current?.present(); // optional
  }}
/>

    </MapView>

      {showSelectionHint && (
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
        mapMovedAfterDelay={mapMovedAfterDelay}
        loadingCategory={map.loadingCategory}
        onSearchArea={map.handleSearchThisArea}
        activeCategory={map.activeCategory}
      />

          {map.activeCategory && map.categoryMarkers.length > 0 && (
  <>
    {console.log('📊 Gelen kategori verisi:', map.categoryMarkers?.length, map.categoryMarkers)}

    <CategoryList
          data={map.categoryMarkers}
          activePlaceId={map.marker?.place_id}
          onSelect={map.handleSelectPlace}
          userCoords={coords}
    />
      </>
    )}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30 }}></View>
          <PlaceDetailSheet
          
            ref={sheetRef}
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

      {/* Route modundaysa Nereden / Nereye Kontrolleri */}
  {mode === 'route' && (
    <View style={styles.routeControls}>
      {/* ⇄ Tuşu sağ üst */}
      <TouchableOpacity onPress={handleReverseRoute} style={styles.reverseCornerButton}>
        <Text style={styles.reverseIcon}>⇄</Text>
      </TouchableOpacity>

      {/* Nereden */}
      <Text style={styles.label}>Nereden</Text>
      <TouchableOpacity
        style={styles.inputButton}
        onPress={() => {
          setOverlayContext('from');
          setShowOverlay(true);
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
          setOverlayContext('to');
          setShowOverlay(true);
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
    onFromSelected={
      overlayContext === 'from'
        ? place => {
            handleFromSelected(place);
            setShowOverlay(false);
          }
        : undefined
    }
    onToSelected={
      overlayContext === 'to'
        ? place => {
            handleSelectDestinationOnMap(place.coords);
            setShowOverlay(false);
          }
        : undefined
    }
    onMapSelect={() => {
      setShowOverlay(false);
      setIsSelectingFromOnMap(true);
    }}
  />
)}

{isNavigating && firstManeuver && (
  <NavigationBanner
    maneuver={firstManeuver}
    duration={routeInfo?.duration}
    distance={routeInfo?.distance}
    onCancel={handleCancelRoute}
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
  fromLocation={map.fromSource}
  toLocation={map.toLocation}
  selectedMode={map.selectedMode}
  routeOptions={map.routeOptions}
  snapPoints={['30%']}
  onCancel={handleCancelRoute}
  onModeChange={map.handleSelectRoute} // ✅ doğru fonksiyon: rota bilgilerini de güncelliyor
  onStart={() => {
    sheetRefRoute.current?.dismiss();
    setMode('explore');        // Geri dönünce keşif moduna geç
    setRouteInfo(null);
    setRouteCoords([]);
    setRouteOptions([]);
    setSelectedMode('driving');
  }}
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
 searchAreaButton: {
    position: 'absolute',
    bottom: 200,            // CategoryList’in hemen üstünde görünmesi için
    left: 20,
    right: 20,
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    zIndex: 5,
  },
    searchAreaText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },


});
