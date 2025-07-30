import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';

export default function RouteStartModal({ visible, onSelect, onSelectOther, onClose }) {
  const [loading, setLoading] = useState(false);
  const [locationAvailable, setLocationAvailable] = useState(false);

  useEffect(() => {
    const checkPermission = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationAvailable(status === 'granted');
    };
    if (visible) checkPermission();
  }, [visible]);

  const handleUseCurrentLocation = async () => {
    setLoading(true);
    try {
      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;
      onSelect({ latitude, longitude });
    } catch (e) {
      console.warn('Konum alınamadı:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Nereden başlamak istersiniz?</Text>

          {locationAvailable && (
            <TouchableOpacity style={styles.option} onPress={handleUseCurrentLocation}>
              <Text style={styles.optionText}>📍 Konumunuz</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.option} onPress={onSelectOther}>
            <Text style={styles.optionText}>📌 Başka bir yer seç</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>İptal</Text>
          </TouchableOpacity>

          {loading && <ActivityIndicator style={{ marginTop: 10 }} />}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#0009',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 12,
    width: '80%',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 20,
    textAlign: 'center',
  },
  option: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  optionText: {
    fontSize: 16,
    textAlign: 'center',
  },
  cancelBtn: {
    marginTop: 8,
  },
  cancelText: {
    color: 'gray',
    textAlign: 'center',
  },
});
