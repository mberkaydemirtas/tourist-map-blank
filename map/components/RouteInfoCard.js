// components/RouteInfoCard.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function RouteInfoCard({ distance, duration, onStart, onCancel }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Rota Bilgisi</Text>
      <Text style={styles.info}>Mesafe: {distance}</Text>
      <Text style={styles.info}>Süre: {duration}</Text>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.buttonStart} onPress={() => console.log('navigasyon başlasın')}
>
          <Text style={styles.buttonText}>Navigasyonu Başlat</Text>
          
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonCancel} onPress={onCancel}>
          <Text style={styles.cancelText}>İptal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    color: '#333',
  },
  info: {
    fontSize: 16,
    marginBottom: 4,
    color: '#555',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  buttonStart: {
    flex: 1,
    backgroundColor: '#1E88E5',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 8,
  },
  buttonCancel: {
    flex: 1,
    backgroundColor: '#eee',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  cancelText: {
    color: '#444',
    fontWeight: '500',
    fontSize: 15,
  },
});
