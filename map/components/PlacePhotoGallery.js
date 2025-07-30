// PlacePhotoGallery.js
import React from 'react';
import { ScrollView, Image, StyleSheet } from 'react-native';

export default function PlacePhotoGallery({ marker }) {
  if (!marker?.photos || !Array.isArray(marker.photos) || marker.photos.length === 0) return null;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.photoScroll}
    >
      {marker.photos.map((uri, idx) => (
        <Image
          key={idx}
          source={{ uri }}
          style={styles.photo}
          resizeMode="cover"
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  photoScroll: {
    marginBottom: 12,
  },
  photo: {
    width: 260,
    height: 160,
    borderRadius: 12,
    marginRight: 10,
  },
});