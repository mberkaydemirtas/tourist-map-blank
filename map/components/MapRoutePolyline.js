// MapRoutePolyline.js
import React from 'react';
import { Polyline } from 'react-native-maps';

export default function MapRoutePolyline({ routes, onRouteSelect }) {
  if (!routes || routes.length === 0) return null;

  return (
    <>
      {routes.map((route) => (
        <Polyline
          key={route.id}
          coordinates={route.decodedCoords}
          strokeColor={route.isPrimary ? '#1E88E5' : '#B3B3B3'}
          strokeWidth={route.isPrimary ? 5 : 4}
          tappable={true}
          onPress={() => onRouteSelect(route)} // route objesini geri yollar
        />
      ))}
    </>
  );
}
