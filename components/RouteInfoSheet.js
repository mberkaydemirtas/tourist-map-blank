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
  <Text style={styles.info}>Mesafe: {distance}</Text>
  <Text style={styles.info}>Süre: {duration}</Text>

  <TouchableOpacity onPress={onStart} style={styles.button}>
    <Text style={styles.buttonText}>Başlat</Text>
  </TouchableOpacity>

  <TouchableOpacity onPress={onCancel} style={styles.cancel}>
    <Text style={styles.cancelText}>İptal</Text>
  </TouchableOpacity>
</BottomSheetView>

    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  info: { fontSize: 16, marginBottom: 4 },
  button: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#1E88E5',
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600' },
  cancel: { marginTop: 10, alignItems: 'center' },
  cancelText: { color: '#999' },
});
