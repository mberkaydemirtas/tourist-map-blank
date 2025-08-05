// MapRoutePolyline.js
import React from 'react';
import { Polyline } from 'react-native-maps';
import { handleRouteSelect } from '../hooks/useMapLogic';

export default function MapRoutePolyline({ routes, onRouteSelect }) {
  if (!routes || routes.length === 0) return null;

  return routes.map((r) => (
    <Polyline
      key={r.id}
      coordinates={r.decodedCoords}
      strokeWidth={r.isPrimary ? 5 : 3}
      strokeColor={r.isPrimary ? '#4285F4' : 'gray'}
      tappable
      onPress={() => handleRouteSelect(mode)}
      lineJoin="round"
    />
  ));
}
