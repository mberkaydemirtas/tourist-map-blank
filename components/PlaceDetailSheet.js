import React, { useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';

const PlaceDetailSheet = ({ sheetRef, place, onChange }) => {
  const snapPoints = useMemo(() => ['30%', '60%', '90%'], []);

  useEffect(() => {
    if (place) {
      console.log('📦 BottomSheet mounted with place:', place);
    }
  }, [place]);

  const handleOpenWeb = useCallback(() => {
    if (place?.website) {
      Linking.openURL(place.website);
    }
  }, [place]);

  if (!place) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      initialSnapIndex={1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={onChange}
    >
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View>
          <Text style={styles.name}>{place.name}</Text>
          {place.address && <Text style={styles.address}>{place.address}</Text>}
          {place.rating && (
            <Text style={styles.rating}>Rating: {place.rating} ⭐</Text>
          )}
          {place.openNow !== undefined && (
            <Text style={styles.status}>
              {place.openNow ? 'Open Now' : 'Closed Now'}
            </Text>
          )}
          {place.website && (
            <TouchableOpacity style={styles.button} onPress={handleOpenWeb}>
              <Text style={styles.buttonText}>Visit Website</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    backgroundColor: '#fff',
  },
  name: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  address: { fontSize: 14, color: '#555', marginBottom: 4 },
  rating: { fontSize: 14, color: '#333', marginBottom: 4 },
  status: { fontSize: 14, marginBottom: 10, color: '#006600' },
  button: {
    backgroundColor: '#4285F4',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  buttonText: { color: '#fff', fontWeight: 'bold' },
});

export default PlaceDetailSheet;
