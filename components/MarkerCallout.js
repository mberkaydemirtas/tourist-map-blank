// src/components/MarkerCallout.js

import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from 'react-native';

export default function MarkerCallout({ marker, isCategory = false }) {
  // marker: { name, address, website?, image?, coordinate }
  return (
    <View style={styles.container}>
      {!isCategory && marker.image && (
        <Image source={{ uri: marker.image }} style={styles.image} />
      )}
      <Text style={styles.title}>{marker.name}</Text>
      {!isCategory && <Text style={styles.address}>{marker.address}</Text>}
      {marker.website && (
        <TouchableOpacity onPress={() => Linking.openURL(marker.website)}>
          <Text style={styles.link}>Web'de Aç</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 200,
    padding: 8,
  },
  image: {
    width: '100%',
    height: 100,
    borderRadius: 6,
    marginBottom: 6,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  address: {
    fontSize: 14,
    color: '#555',
    marginBottom: 6,
  },
  link: {
    color: '#4285F4',
    textDecorationLine: 'underline',
    fontSize: 14,
  },
});
