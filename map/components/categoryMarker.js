// components/CategoryMarker.js
import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Marker, Callout } from 'react-native-maps';
import { View, Text, StyleSheet, Image, Animated } from 'react-native';
import { normalizeCoord } from '../utils/coords';

const ICONS = {
  cafe: require('../../assets/icons/cafe.png'),
  restaurant: require('../../assets/icons/restaurant.png'),
  hotel: require('../../assets/icons/hotel.png'),
  // diğer kategoriler eklenebilir
};

const CategoryMarker = forwardRef(function CategoryMarker(
  {
    item,
    onSelect,
    activeCategory,
    iconSize = 24,
    zIndexBoost = 10,
    fadeDuration = 180,
    trackingOffDelay = 180,
  },
  markerRef // 👈 Marker ref’i dışarı veriyoruz
) {
  const [imgReady, setImgReady] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);
  const [tracking, setTracking] = useState(true);
  const opacity = useRef(new Animated.Value(0)).current;

  const coordinate = normalizeCoord(
    item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item
  );
  if (!coordinate) return null;

  const placeId = item.place_id || item.id;
  const title   = item.name || item.description || 'Yer';

  const iconKey = useMemo(() => {
    if (activeCategory && ICONS[activeCategory.toLowerCase()]) return activeCategory.toLowerCase();
    if (Array.isArray(item.types)) {
      const found = item.types.find((t) => ICONS[t?.toLowerCase?.()]);
      return found ? found.toLowerCase() : null;
    }
    return null;
  }, [activeCategory, item.types]);

  const iconSource = iconKey ? ICONS[iconKey] : null;

  useEffect(() => {
    if (!iconSource) return;
    if (imgReady || imgErrored) {
      Animated.timing(opacity, { toValue: 1, duration: fadeDuration, useNativeDriver: true }).start();
      const t = setTimeout(() => setTracking(false), trackingOffDelay);
      return () => clearTimeout(t);
    }
  }, [imgReady, imgErrored, iconSource, opacity, fadeDuration, trackingOffDelay]);

  const isActiveKey = iconKey === activeCategory?.toLowerCase();

  return (
    <Marker
      ref={markerRef} // 👈 önemli
      coordinate={coordinate}
      onPress={() => onSelect?.(placeId, coordinate, title)}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 1 }}
      calloutAnchor={{ x: 0.5, y: -0.5 }}
      pinColor={!iconSource || (!imgReady && !imgErrored) ? '#FF5A5F' : undefined}
      zIndex={iconSource && isActiveKey ? zIndexBoost : 1}
    >
      {iconSource ? (
        <Animated.View style={{ opacity }}>
          <Image
            source={iconSource}
            style={{ width: iconSize, height: iconSize, resizeMode: 'contain' }}
            onLoad={() => setImgReady(true)}
            onLoadEnd={() => setImgReady((v) => v || true)}
            onError={() => { setImgErrored(true); setImgReady(true); }}
          />
        </Animated.View>
      ) : null}

      <Callout>
        <View style={styles.calloutContainer}>
          <Text style={styles.calloutText}>{item.name}</Text>
        </View>
      </Callout>
    </Marker>
  );
});

export default CategoryMarker;

const styles = StyleSheet.create({
  calloutContainer: {
    minWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  calloutText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    color: '#333',
  },
});
