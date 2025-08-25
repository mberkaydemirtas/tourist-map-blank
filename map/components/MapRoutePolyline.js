// src/components/MapRoutePolyline.js
import React from 'react';
import { Polyline, Marker } from 'react-native-maps';
import { Text, StyleSheet } from 'react-native';

export default function MapRoutePolyline({ routes, onRouteSelect }) {
  if (!routes || routes.length === 0) return null;

  const primary = routes.find(r => r.isPrimary);
  const primaryDuration = primary?.duration ?? null;

  // Orta noktayı bulmak için yardımcı fonksiyon
  const getMidpoint = coords => {
    const midIndex = Math.floor(coords.length / 2);
    return coords[midIndex];
  };

  return (
    <>
      {routes.map(route => {
        const isPrimary = route.isPrimary;
        const strokeColor = isPrimary ? '#1E88E5' : '#B3B3B3';
        const strokeWidth = isPrimary ? 6 : 4;
        const zIndex = isPrimary ? 2 : 1;
        const label = !isPrimary && primaryDuration
          ? getDeltaLabel(primaryDuration, route.duration)
          : null;

        return (
          <React.Fragment key={route.id}>
            <Polyline
              coordinates={route.decodedCoords}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              lineCap="round"
              tappable
              zIndex={zIndex}
              onPress={() => onRouteSelect(route)}
            />
            {label && (
              <Marker
                coordinate={getMidpoint(route.decodedCoords)}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={zIndex + 1}
              >
                <Text style={styles.label}>{label}</Text>
              </Marker>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function getDeltaLabel(primary, current) {
  const deltaSec = current - primary;
  const deltaMin = Math.round(deltaSec / 60);
  if (Math.abs(deltaMin) < 1) return null;
  return deltaMin > 0
    ? `${deltaMin} dk daha yavaş`
    : `${Math.abs(deltaMin)} dk daha hızlı`;
}

const styles = StyleSheet.create({
  label: {
    backgroundColor: 'white',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 12,
    color: '#333',
    overflow: 'hidden',
  },
});
