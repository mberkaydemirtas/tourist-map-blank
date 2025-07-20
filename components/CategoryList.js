import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  Image,
} from 'react-native';

const CARD_WIDTH = Dimensions.get('window').width * 0.8;
const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function CategoryList({ data, activePlaceId, onSelect, userCoords }) {
  const [filterByRating, setFilterByRating] = useState(false);
  const [sortBy, setSortBy] = useState('default');
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const flatListRef = useRef();

  const getDistance = (a, b) => {
    if (!a || !b) return Infinity;
    return Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude);
  };

  const uniqueData = useMemo(() => {
    const seen = new Set();
    return data.filter(item => {
      const lat = item.coordinate?.latitude ?? item.geometry?.location?.lat;
      const lng = item.coordinate?.longitude ?? item.geometry?.location?.lng;
      const key = `${item.name}-${lat}-${lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  const filteredData = useMemo(() => {
    let list = [...uniqueData];
    if (filterByRating) {
      list = list.filter(item => item.rating && item.rating >= 4);
    }

    if (searchQuery.trim().length > 0) {
      const query = searchQuery.toLowerCase();
      list = list.filter(item => item.name.toLowerCase().includes(query));
    }

    if (sortBy === 'rating') {
      list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (sortBy === 'distance' && userCoords) {
      list.sort((a, b) => {
        const aCoord = a.coordinate ?? {
          latitude: a.geometry?.location?.lat,
          longitude: a.geometry?.location?.lng,
        };
        const bCoord = b.coordinate ?? {
          latitude: b.geometry?.location?.lat,
          longitude: b.geometry?.location?.lng,
        };
        return getDistance(userCoords, aCoord) - getDistance(userCoords, bCoord);
      });
    }

    return list;
  }, [uniqueData, filterByRating, sortBy, userCoords, searchQuery]);

  useEffect(() => {
    if (activePlaceId && flatListRef.current) {
      const index = filteredData.findIndex(item => item.place_id === activePlaceId);
      if (index >= 0) {
        flatListRef.current.scrollToIndex({ index, animated: true });
      }
    }
  }, [activePlaceId, filteredData]);

  const handleSelect = (place_id, coords, name) => {
    onSelect(place_id, coords, name);
    setModalVisible(false);
  };

  const renderItem = ({ item }) => {
    const isActive = activePlaceId === item.place_id;
    const latitude = item.coordinate?.latitude ?? item.geometry?.location?.lat;
    const longitude = item.coordinate?.longitude ?? item.geometry?.location?.lng;
    const distanceText = userCoords
      ? `${(getDistance(userCoords, { latitude, longitude }) * 111).toFixed(1)} km uzaklıkta`
      : null;

    return (
      <TouchableOpacity
        onPress={() => handleSelect(item.place_id, { latitude, longitude }, item.name)}
        style={[styles.card, isActive && styles.activeCard]}
      >
        <Text style={styles.title}>
          {item.name.length > 40 ? item.name.slice(0, 40) + '…' : item.name}
        </Text>
        {item.rating && (
          <Text style={styles.rating}>
            {'⭐'.repeat(Math.round(item.rating))} {item.rating.toFixed(1)}{' '}
            {item.user_ratings_total ? `(${item.user_ratings_total})` : ''}
          </Text>
        )}
        {distanceText && <Text style={styles.distance}>{distanceText}</Text>}
        <Text style={styles.address}>
          {item.address || 'Adres bilgisi yok'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <TouchableOpacity onPress={() => setFilterByRating(prev => !prev)}>
          <Text style={[styles.controlText, filterByRating && styles.controlActive]}>
            {filterByRating ? '4+ filtre ✖️' : '4+ filtre'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setSortBy(prev =>
          prev === 'rating' ? 'default' : 'rating')}>
          <Text style={[styles.controlText, sortBy === 'rating' && styles.controlActive]}>
            ⭐ sıralama
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSortBy(prev =>
            prev === 'distance' ? 'default' : 'distance')}
        >
          <Text style={[styles.controlText, sortBy === 'distance' && styles.controlActive]}>
            📍 yakınlık
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => {
          setFilterByRating(false);
          setSortBy('default');
        }}>
          <Text style={styles.resetButton}>Sıfırla</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setModalVisible(true)}>
          <Text style={styles.expandButton}>⇅ Genişlet</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        horizontal
        data={filteredData}
        renderItem={renderItem}
        keyExtractor={item => item.place_id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      <Modal visible={modalVisible} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Tüm Sonuçlar</Text>
            <Pressable onPress={() => setModalVisible(false)}>
              <Text style={styles.modalClose}>Kapat</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Ara (örn. Starbucks)"
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <ScrollView
            contentContainerStyle={styles.modalList}
            onScrollEndDrag={(e) => {
              if (e.nativeEvent.contentOffset.y < -30) {
                setModalVisible(false);
              }
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            bounces={true}
            alwaysBounceVertical={true}
          >
            {filteredData.map((item) => {
              const latitude = item.coordinate?.latitude ?? item.geometry?.location?.lat;
              const longitude = item.coordinate?.longitude ?? item.geometry?.location?.lng;

              return (
                <TouchableOpacity
                  key={item.place_id}
                  onPress={() => handleSelect(item.place_id, { latitude, longitude }, item.name)}
                  style={[styles.card, activePlaceId === item.place_id && styles.activeCard]}
                >
                  <Text style={styles.title}>
                    {item.name.length > 40 ? item.name.slice(0, 40) + '…' : item.name}
                  </Text>
                  {item.rating && (
                    <Text style={styles.rating}>
                      {'⭐'.repeat(Math.min(5, Math.round(item.rating)))} {item.rating.toFixed(1)}{' '}
                      {item.user_ratings_total ? `(${item.user_ratings_total})` : ''}
                    </Text>
                  )}
                  {userCoords && (
                    <Text style={styles.distance}>
                      {(Math.hypot(userCoords.latitude - latitude, userCoords.longitude - longitude) * 111).toFixed(1)} km uzaklıkta
                    </Text>
                  )}
                  <Text style={styles.address}>{item.address || 'Adres bilgisi yok'}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  controlText: {
    fontSize: 13,
    color: '#444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  controlActive: {
    backgroundColor: '#4285F4',
    color: '#fff',
    fontWeight: 'bold',
  },
  resetButton: {
    fontSize: 13,
    color: 'white',
    backgroundColor: '#d9534f',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontWeight: 'bold',
  },
  expandButton: {
    fontSize: 13,
    color: '#fff',
    backgroundColor: '#5cb85c',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontWeight: 'bold',
  },
  listContent: {
    paddingHorizontal: 5,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    marginHorizontal: 6,
    width: CARD_WIDTH,
    elevation: 3,
  },
  activeCard: {
    borderColor: '#007aff',
    borderWidth: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  rating: {
    fontSize: 14,
    color: '#f1c40f',
    marginBottom: 4,
  },
  distance: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  address: {
    fontSize: 14,
    color: '#444',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fafafa',
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalClose: {
    fontSize: 16,
    color: '#d9534f',
  },
  modalList: {
    paddingTop: 20,
    paddingBottom: 100,
  },
  searchInput: {
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
    borderColor: '#ccc',
    borderWidth: 1,
  },
});
