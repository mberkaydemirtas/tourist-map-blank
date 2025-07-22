import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { autocomplete, getPlaceDetails } from '../services/maps';

export default function RouteSearchBar({ placeholder, value = '', onPlaceSelect }) {
  console.log('🟢 RouteSearchBar RENDER EDİLDİ');

  const [input, setInput] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  // dışardan gelen value değişince input güncellensin
  useEffect(() => {
    console.log('🟡 value değişti:', value);
    setInput(value || '');
  }, [value]);

  const handleChange = async (text) => {
    console.log('🔤 Kullanıcı yazdı:', text);
    setInput(text);

    if (text.length < 2) {
      console.log('🧹 Öneriler temizlendi');
      setSuggestions([]);
      return;
    }

    setLoading(true);
    console.log('🌐 Autocomplete çağrılıyor:', text);
    const results = await autocomplete(text);
    console.log('🌐 Autocomplete sonuçları:', results);
    setSuggestions(results || []);
    setLoading(false);
  };

  const handleSelect = async (item) => {
    console.log('✅ Seçildi:', item.description);
    Keyboard.dismiss();
    setInput(item.description);
    setSuggestions([]);

    const details = await getPlaceDetails(item.place_id);
    console.log('📍 PlaceDetails:', details);

    if (details) {
      onPlaceSelect({
        description: item.description,
        coords: details.coord,
        place: details,
        key: 'selected',
      });
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#888"
        value={input}
        onChangeText={handleChange}
        style={styles.input}
      />
      {loading && <ActivityIndicator size="small" color="#999" style={styles.loading} />}
      {suggestions.length > 0 && (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.place_id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              activeOpacity={0.7}
              onPress={() => handleSelect(item)}
            >
              <Text>{item.description}</Text>
            </TouchableOpacity>
          )}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 999,
    overflow: 'visible',
  },
  input: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 6,
    borderColor: '#ccc',
    borderWidth: 1,
    fontSize: 15,
  },
  loading: {
    position: 'absolute',
    right: 10,
    top: Platform.OS === 'ios' ? 12 : 10,
  },
  list: {
    position: 'absolute',
    top: 45,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    maxHeight: 180,
    borderColor: '#ccc',
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    zIndex: 1000,
    elevation: 10,
    overflow: 'visible',
  },
  item: {
    padding: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
});
