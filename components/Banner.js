// src/components/Banner.js

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';

export default function Banner({ available, onRetry }) {
  // GPS izni reddedildi ya da servis kapalıysa göster
  if (available) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        Konum kapalı — arama ile kullanabilirsiniz.
      </Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.bannerLink}>Tekrar Dene</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Linking.openSettings()}>
        <Text style={styles.bannerLink}>Ayarları Aç</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 0,
    right: 0,
    backgroundColor: '#333',
    padding: 8,
    zIndex: 999,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: {
    color: '#fff',
    flex: 1,
  },
  bannerLink: {
    color: '#4da6ff',
    fontWeight: 'bold',
    marginLeft: 10,
  },
});
