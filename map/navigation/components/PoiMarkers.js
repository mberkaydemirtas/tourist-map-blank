// src/navigation/components/PoiMarkers.js
import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Marker, Callout } from 'react-native-maps';

export default function PoiMarkers({
  stablePoiList = [],
  setMarkerRef,
  selectedId,
  setSelectedId,
  onPoiPress,
  handleAddStopFromPOI,
}) {
  const items = useMemo(() => stablePoiList || [], [stablePoiList]);

  return items.map((p) => {
    const lat = p?.geometry?.location?.lat;
    const lng = p?.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const id = p.__id;

    return (
      <Marker
        ref={(r) => setMarkerRef && id && setMarkerRef(id, r)}
        key={`poi_${id}`}
        coordinate={{ latitude: lat, longitude: lng }}
        anchor={{ x: 0.5, y: 1 }}
        calloutAnchor={{ x: 0.5, y: 0 }}
        tracksViewChanges={false}
        zIndex={9999}
        onPress={(e) => {
          e?.stopPropagation?.();
          setSelectedId?.(id);
          onPoiPress?.(p);
        }}
        onCalloutPress={() => handleAddStopFromPOI?.(p)}
      >
        <View key={`pin_${id}`} collapsable={false} style={S.poiDotOuter}>
          <Text style={S.poiEmoji}>📍</Text>
        </View>

        <Callout key={`co_${id}`} tooltip={Platform.OS === 'ios'}>
          <View style={[S.calloutOuter, Platform.OS === 'android' && { maxWidth: 440, minWidth: 300 }]} collapsable={false}>
            <View style={[S.calloutCard, Platform.OS === 'android' && { maxWidth: 440, minWidth: 300 }]}>
              <Text style={S.calloutTitle} numberOfLines={1}>{p?.name || 'Seçilen yer'}</Text>
              <Text style={S.calloutSub} numberOfLines={1}>
                {(p?.rating ? `★ ${p.rating} • ` : '') + (p?.vicinity || '')}
              </Text>
              <TouchableOpacity style={S.calloutCta} onPress={() => handleAddStopFromPOI?.(p)} activeOpacity={0.8}>
                <Text style={S.calloutCtaText}>Durak ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Callout>
      </Marker>
    );
  });
}

const S = StyleSheet.create({
  poiDotOuter: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 6,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  poiEmoji: { fontSize: 16 },
  calloutOuter: { shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  calloutCard: {
    minWidth: 280,
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  calloutTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  calloutSub: { marginTop: 6, fontSize: 13, color: '#555' },
  calloutCta: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#E6F4EA', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  calloutCtaText: { fontSize: 13, fontWeight: '700', color: '#111' },
});
