// src/navigation/components/WaypointMarkers.js
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

function toLatLng(w) {
  if (!w) return null;
  const lat =
    w.lat ??
    w.latitude ??
    w?.coords?.latitude;
  const lng =
    w.lng ??
    w.longitude ??
    w?.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function WaypointMarkers({ waypoints = [] }) {
  return waypoints.map((w, idx) => {
    const ll = toLatLng(w);
    if (!ll) return null;
    const keyBase = w.place_id || `${ll.lat}_${ll.lng}`;
    return (
      <Marker
        key={`wp_${idx}_${keyBase}`}
        coordinate={{ latitude: ll.lat, longitude: ll.lng }}
      >
        <View style={S.wpDotOuter}>
          <View style={S.wpDotInner}>
            <Text style={S.wpNum}>{idx + 1}</Text>
          </View>
        </View>
      </Marker>
    );
  });
}

const S = StyleSheet.create({
  wpDotOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.5)',
  },
  wpDotInner: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFC107',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  wpNum: { fontSize: 11, fontWeight: '700', color: '#111' },
});

