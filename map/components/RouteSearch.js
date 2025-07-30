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
import { autocomplete, getPlaceDetails } from '../maps';

export default function RouteSearchBar({ placeholder, value = '', onPlaceSelect }) {
  console.log('🟢 RouteSearchBar RENDER EDİLDİ');
  useEffect(() => {
    console.log('🟣 [DEBUG] RouteSearchBar dışarıdan gelen value:', value);
  }, [value]);

  const [inputText, setInputText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Gelen value her değiştiğinde inputText'e trim'lenmiş olarak yaz
  useEffect(() => {
    setInputText((value || '').trim());
  }, [value]);

  // inputText değişimlerini loglayalım
  useEffect(() => {
    console.log('🔁 inputText güncellendi:', inputText);
  }, [inputText]);

  const handleChange = async (text) => {
    console.log('🔤 Kullanıcı yazdı:', text);
    setInputText(text);

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
    const desc = (item.description || '').trim();
    setInputText(desc);
    setSuggestions([]);

    const details = await getPlaceDetails(item.place_id);
    console.log('📍 PlaceDetails:', details);

    if (details && typeof onPlaceSelect === 'function') {
      onPlaceSelect({
        description: desc,
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
        value={inputText}
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
    width: '100%',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 6,
    borderColor: '#ccc',
    borderWidth: 1,
    fontSize: 15,
    color: '#333',
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
