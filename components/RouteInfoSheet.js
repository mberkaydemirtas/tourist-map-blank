// src/components/RouteInfoSheet.js
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

export default function RouteInfoSheet({ modalRef, distance, duration, onStart, onCancel }) {
  const snapPoints = useMemo(() => ['30%', '50%', '70%'], []);

  // Mount olduğunda otomatik aç
  useEffect(() => {
    if (modalRef.current) {
      modalRef.current.present();
    }
  }, [modalRef]);

  return (
    <BottomSheetModal
      ref={modalRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      handleIndicatorStyle={{ backgroundColor: '#ccc' }}
      style={styles.sheet}
      backgroundStyle={styles.background}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Rota Bilgisi</Text>
        <Text style={styles.info}>Mesafe: {distance}</Text>
        <Text style={styles.info}>Süre: {duration}</Text>

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.buttonStart} onPress={onStart}>
            <Text style={styles.buttonText}>Navigasyonu Başlat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonCancel} onPress={onCancel}>
            <Text style={styles.cancelText}>İptal</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    elevation: 20,
    zIndex: 20,
  },
  background: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 19,
    zIndex: 19,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    color: '#333',
  },
  info: {
    fontSize: 16,
    marginBottom: 6,
    color: '#555',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
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
