// src/homePage/MiniMapCard.js
import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { useLocation } from '../map/hooks/useLocation'; // mevcut hook'unuz

export default function MiniMapCard({ onExpand }) {
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const { coords } = useLocation();

  const initialRegion = useMemo(() => {
    // GPS yoksa Ankara fallback
    const lat = coords?.latitude ?? 39.925533;
    const lng = coords?.longitude ?? 32.866287;
    return {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }, [coords]);

  // Konum güncellenirse önizleme haritasını yumuşakça kaydır
  useEffect(() => {
    if (coords && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        500
      );
    }
  }, [coords]);

  const handleExpand = () => {
    onExpand?.() ?? navigation.navigate('Map', { entryPoint: 'home-preview' });
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Harita (Önizleme)</Text>
      </View>

      <View style={styles.mapShadow}>
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            initialRegion={initialRegion}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
            mapType={Platform.OS === 'android' ? 'standard' : 'mutedStandard'}
            // ✅ Önizlemede etkileşim açık (kaydır/zoom serbest)
            scrollEnabled
            rotateEnabled
            pitchEnabled
            zoomEnabled
          />

          {/* ✅ Sağ alt köşe: büyütme düğmesi */}
          <TouchableOpacity style={styles.expandFab} onPress={handleExpand} activeOpacity={0.9}>
            <Text style={styles.expandIcon}>⤢</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    justifyContent: 'space-between',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  mapShadow: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  mapContainer: {
    height: 220, // mini harita yüksekliği
    backgroundColor: '#13151A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#23262F',
  },
  // Sağ alt köşe FAB
  expandFab: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  expandIcon: {
    color: '#fff',
    fontSize: 16, // istersen 18–20 yap
    fontWeight: '700',
  },
});
