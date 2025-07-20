import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';

export default function Banner({ available, onRetry, permissionDenied }) {
  const openAppSettings = () => {
    if (Platform.OS === 'android') {
      Linking.openSettings(); // Android için uygulama ayarlarını açar
    } else {
      Linking.openURL('app-settings:'); // iOS için
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {permissionDenied
          ? 'Konum izni verilmedi. Devam etmek için izin vermeniz gerekiyor.'
          : 'Konum servisi kapalı. Lütfen açmayı deneyin.'}
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={permissionDenied ? openAppSettings : onRetry}
      >
        <Text style={styles.buttonText}>
          {permissionDenied ? 'İzinleri Ayarlarda Aç' : 'Konumu Aç'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#fff8e1',
    padding: 14,
    borderRadius: 8,
    elevation: 3,
    zIndex: 99,
    borderColor: '#ff9800',
    borderWidth: 1,
  },
  text: {
    color: '#333',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#ff9800',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
