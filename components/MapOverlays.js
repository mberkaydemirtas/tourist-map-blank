// MapOverlays.js
import React from 'react';
import { View } from 'react-native';
import Banner from './Banner';
import LocationButton from './LocationButton';

export default function MapOverlays({ available, coords, onRetry, onRecenter }) {
  return (
    <>
      {!available && <Banner available={available} onRetry={onRetry} />}

      {available && coords && (
        <LocationButton
          onPress={() => {
            const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
            onRecenter(region);
          }}
          style={{ position: 'absolute', top: 100, right: 20, zIndex: 999 }}
        />
      )}
    </>
  );
}