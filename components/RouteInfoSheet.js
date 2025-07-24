// src/components/RouteInfoSheet.js
import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';

export default function RouteInfoSheet({ sheetRef, distance, duration, onCancel, onStart }) {
  useEffect(() => {
    console.log('✅ RouteInfoSheet render edildi!');
  }, []);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['25%', '40%']}
      index={0}
      onChange={(index) => console.log('🟣 BottomSheet index:', index)}
      backgroundStyle={{ backgroundColor: 'white' }}
      handleIndicatorStyle={{ backgroundColor: '#ccc' }}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Yol Bilgisi</Text>
        <Text style={styles.info}>Mesafe: {distance || 'Bilinmiyor'}</Text>
        <Text style={styles.info}>Süre: {duration || 'Bilinmiyor'}</Text>

        <TouchableOpacity style={styles.button} onPress={onStart}>
          <Text style={styles.buttonText}>Başlat</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>İptal</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: 16,
    backgroundColor: 'white',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  info: {
    fontSize: 16,
    marginBottom: 4,
  },
  button: {
    marginTop: 16,
    backgroundColor: '#1E88E5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancel: {
    marginTop: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 14,
  },
});
