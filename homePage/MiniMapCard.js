// src/homePage/MiniMapCard.js
import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { useLocation } from '../map/hooks/useLocation';

export default function MiniMapCard({ onExpand }) {
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const lastRegionRef = useRef(null);
  const { coords } = useLocation();

  const initialRegion = useMemo(() => {
    const lat = coords?.latitude ?? 39.925533;
    const lng = coords?.longitude ?? 32.866287;
    return {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
  }, [coords]);

  useEffect(() => {
    if (coords && mapRef.current) {
      const r = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      };
      lastRegionRef.current = r; // son bölgeyi güncel tut
      mapRef.current.animateToRegion(r, 500);
    }
  }, [coords]);

  const handleRegionChangeComplete = useCallback((region) => {
    lastRegionRef.current = region;
  }, []);

  const handleExpand = useCallback(() => {
    const previewRegion = lastRegionRef.current || initialRegion;
    // onExpand varsa önce onu, yoksa Map ekranına parametreyle git
    if (onExpand) {
      onExpand();
    } else {
      navigation.navigate('Map', {
        entryPoint: 'home-preview',
        previewRegion,
      });
    }
  }, [initialRegion, onExpand, navigation]);

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
            onRegionChangeComplete={handleRegionChangeComplete}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
            mapType={Platform.OS === 'android' ? 'standard' : 'mutedStandard'}
            scrollEnabled
            rotateEnabled
            pitchEnabled
            zoomEnabled
          />
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
    height: 220,
    backgroundColor: '#13151A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#23262F',
  },
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
    fontSize: 16,
    fontWeight: '700',
  },
});
