import React, { useState } from 'react';
import { Marker } from 'react-native-maps';
import { Image } from 'react-native';

export default function CategoryMarker({ item, onSelect, activeCategory }) {
  const [iconLoaded, setIconLoaded] = useState(false);

  const coordinate = item.coordinate ?? {
    latitude: item.geometry?.location?.lat,
    longitude: item.geometry?.location?.lng,
  };

  const iconSource = (() => {
    switch (activeCategory) {
      case 'cafe': return require('../assets/icons/cafe.png');
      case 'restaurant': return require('../assets/icons/restaurant.png');
      case 'hotel': return require('../assets/icons/hotel.png');
    }
  })();

  return (
    <Marker
      coordinate={coordinate}
      onPress={() => onSelect(item.place_id, coordinate, item.name)}
      tracksViewChanges={!iconLoaded}
    >
      <Image
        source={iconSource}
        style={{ width: 30, height: 30 }}
        onLoad={() => setIconLoaded(true)}
      />
    </Marker>
  );
}
