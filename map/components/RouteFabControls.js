// src/components/RouteFabControls.js
import React from 'react';
import { TouchableOpacity, Text } from 'react-native';

export default function RouteFabControls({
  styles,
  waypointsCount = 0,
  onAddStop,
  onEditStops,
}) {
  return (
    <>
      <TouchableOpacity
        style={styles.addStopFab}
        onPress={onAddStop}
        activeOpacity={0.9}
      >
        <Text style={styles.addStopFabText}>＋</Text>
      </TouchableOpacity>

      {waypointsCount > 0 && (
        <TouchableOpacity
          style={styles.editStopsBtn}
          onPress={onEditStops}
          activeOpacity={0.9}
        >
          <Text style={styles.editStopsText}>
            Durakları düzenle ({waypointsCount})
          </Text>
        </TouchableOpacity>
      )}
    </>
  );
}
