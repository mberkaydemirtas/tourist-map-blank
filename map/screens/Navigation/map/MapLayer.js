// src/screens/Navigation/map/MapLayer.js
import React from 'react';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

export default function MapLayer({
  mapRef,
  onMapReady,
  initialRegion,
  onUserLocationChange,
  onPress,
  onPanDrag,
  showUser,
  safePolylineCoords = [],
  fallbackLine = [],
  children,
}) {
  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={{ flex: 1 }}
      onMapReady={onMapReady}
      initialRegion={initialRegion}
      showsUserLocation={showUser}
      onUserLocationChange={onUserLocationChange}
      onPress={onPress}
      onPanDrag={onPanDrag}
    >
      {/* ana rota */}
      {safePolylineCoords.length > 1 && (
        <Polyline
          coordinates={safePolylineCoords}
          strokeWidth={6}
          strokeColor="#1E88E5"
        />
      )}

      {/* fallback çizgi */}
      {safePolylineCoords.length <= 1 &&
        fallbackLine.length === 2 && (
          <Polyline
            coordinates={fallbackLine}
            strokeWidth={4}
            strokeColor="#1E88E5"
          />
        )}

      {/* NavigationScreen'den gelen marker/alt layer'lar */}
      {children}
    </MapView>
  );
}
