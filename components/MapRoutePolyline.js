// MapRoutePolyline.js
import React from 'react';
import { Polyline } from 'react-native-maps';

export default function MapRoutePolyline({ routeCoords }) {
  if (!routeCoords || routeCoords.length === 0) return null;

  return (
    <Polyline
      coordinates={routeCoords}
      strokeWidth={4}
      strokeColor="#4285F4"
      lineJoin="round"
    />
  );
}
