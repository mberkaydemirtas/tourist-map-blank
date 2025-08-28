// src/layers/PoiAlongRouteLayer.js
import React from 'react';
import { View, Text, Platform, TouchableOpacity } from 'react-native';
import { Marker, Callout } from 'react-native-maps';

export default function PoiAlongRouteLayer({
  list,                 // stablePoiList
  setMarkerRef,         // (id, ref) => void
  onPoiPress,           // (place) => void
  onAddStop,            // (place) => void
  styles,
}) {
  if (!Array.isArray(list) || list.length === 0) return null;

  return (
    <>
      {list.map((p) => {
        const lat = p?.geometry?.location?.lat;
        const lng = p?.geometry?.location?.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const id = p.__id;

        return (
          <Marker
            ref={(r) => setMarkerRef(id, r)}
            key={`poi_${id}`}
            coordinate={{ latitude: lat, longitude: lng }}
            anchor={{ x: 0.5, y: 1 }}
            calloutAnchor={{ x: 0.5, y: 0 }}
            tracksViewChanges={false}
            zIndex={9999}
            onPress={(e) => {
              e?.stopPropagation?.();
              onPoiPress(p);
            }}
            onCalloutPress={() => onAddStop(p)}
          >
            <View style={styles.poiDotOuter}>
              <Text style={styles.poiEmoji}>📍</Text>
            </View>
            <Callout tooltip={Platform.OS === 'ios'}>
              <View style={styles.calloutCard}>
                <Text style={styles.calloutTitle} numberOfLines={1}>
                  {p?.name || 'Seçilen yer'}
                </Text>
                <Text style={styles.calloutSub} numberOfLines={1}>
                  {(p?.rating ? `★ ${p.rating} • ` : '') + (p?.vicinity || '')}
                </Text>
                <TouchableOpacity
                  style={styles.calloutCta}
                  onPress={() => onAddStop(p)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.calloutCtaText}>Durak ekle</Text>
                </TouchableOpacity>
              </View>
            </Callout>
          </Marker>
        );
      })}
    </>
  );
}
