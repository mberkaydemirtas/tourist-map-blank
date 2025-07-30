// PlaceContactButtons.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

export default function PlaceContactButtons({ marker }) {
  if (!marker) return null;

  return (
    <View style={styles.actionsRow}>
      {marker.phone && (
        <TouchableOpacity
          style={styles.callButton}
          onPress={() => Linking.openURL(`tel:${marker.phone}`)}
        >
          <Text style={styles.callText}>Call</Text>
        </TouchableOpacity>
      )}

      {marker.website && (
        <TouchableOpacity
          style={styles.websiteButton}
          onPress={() => Linking.openURL(marker.website)}
        >
          <Text style={styles.websiteText}>Website</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  callButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  callText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  websiteButton: {
    backgroundColor: '#777',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  websiteText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});