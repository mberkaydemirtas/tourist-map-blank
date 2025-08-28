// src/navigation/components/AltRoutesLayer.js
import React, { Fragment } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { formatAltComparison } from '../navFormatters'; // navigation/ içindeki mevcut dosyanıza göre

const toLatLng = ([lng, lat]) => ({ latitude: lat, longitude: lng });
const toLatLngArr = (coords = []) => coords.map(toLatLng);

export default function AltRoutesLayer({
  altMode,
  altFetching,
  isAddingStop,
  altRoutes = [],
  baselineSec, // effSec
  applyAlternative,
}) {
  const show = altMode && !altFetching && !isAddingStop;
  if (!show) return null;

  return (
    <Fragment>
      {/* Gri alternatif polylineler */}
      {altRoutes.map((r) => (
        <Polyline
          key={`alt_${r.id}`}
          coordinates={toLatLngArr(r.coords)}
          strokeWidth={4}
          strokeColor="#777"
          lineDashPattern={[6, 6]}
          tappable
          onPress={() => applyAlternative?.(r)}
        />
      ))}

      {/* Etiket marker’ları */}
      {altRoutes.map((r) => {
        const midIdx = Math.floor(r.coords.length / 2);
        const mid = r.coords[midIdx] || r.coords[0];
        const cmp = formatAltComparison(baselineSec, r.duration);
        const label = cmp.text;
        const tone = cmp.tone; // 'faster' | 'slower' | 'neutral'
        return (
          <Marker key={`alt_label_${r.id}`} coordinate={{ latitude: mid[1], longitude: mid[0] }}>
            <TouchableOpacity onPress={() => applyAlternative?.(r)} activeOpacity={0.8}>
              <View style={[S.altLabel, S[`alt_${tone}`]]}>
                <Text style={[S.altLabelText, S[`altText_${tone}`]]}>{label}</Text>
              </View>
            </TouchableOpacity>
          </Marker>
        );
      })}
    </Fragment>
  );
}

const S = StyleSheet.create({
  altLabel: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    elevation: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  altLabelText: { fontSize: 12, fontWeight: '700', color: '#1E88E5' },
  alt_faster: { backgroundColor: '#E6F4EA', borderColor: '#A8D5B8' },
  alt_slower: { backgroundColor: '#FDECEA', borderColor: '#F5C2C0' },
  alt_neutral: { backgroundColor: 'white', borderColor: '#ddd' },
  altText_faster: { color: '#1E7E34' },
  altText_slower: { color: '#B42318' },
  altText_neutral: { color: '#1E88E5' },
});
