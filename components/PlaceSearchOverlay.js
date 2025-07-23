// components/PlaceSearchOverlay.js
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  SectionList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete, getPlaceDetails } from '../services/maps';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 5;

export default function PlaceSearchOverlay() {
  const navigation = useNavigation();
  const route = useRoute();

  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    AsyncStorage.getItem(HISTORY_KEY).then(h => setHistory(h ? JSON.parse(h) : []));
  }, []);

  useEffect(() => {
    if (query.length >= 2) {
      autocomplete(query).then(preds => {
        const items = preds.map(p => ({ key: p.place_id, description: p.description }));
        setSuggestions(items);
      });
    } else {
      setSuggestions([]);
    }
  }, [query]);

  const handleSelect = async (item) => {
    Keyboard.dismiss();
    console.log('🟡 Seçilen item:', item);

    let place = item;

    if (!item.key || item.key === item.description) {
      console.log('🔄 Autocomplete ile tekrar sorgulanıyor:', item.description);
      const results = await autocomplete(item.description);
      if (results.length === 0) {
        console.warn('❌ Autocomplete sonucu yok.');
        return;
      }
      place = {
        key: results[0].place_id,
        description: results[0].description,
      };
    }

    try {
      const details = await getPlaceDetails(place.key);
      console.log('📦 Detay coords:', details.coords);

      const full = {
        key: place.key,
        description: place.description,
        coords: details.coords,
      };

      console.log('✅ Final seçilen yer:', full);

      const newHistory = [full.description, ...history.filter(h => h !== full.description)].slice(0, MAX_HISTORY);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));

      route.params?.onPlaceSelected?.(full);
      navigation.goBack();
    } catch (e) {
      console.warn('❌ getPlaceDetails başarısız:', e);
    }
  };

  const sections = [
    query.length >= 2 && { title: 'Öneriler', data: suggestions },
    query.length === 0 && history.length > 0 && {
      title: 'Geçmiş',
      data: history.map(h => ({ key: h, description: h, isHistory: true })),
    },
  ].filter(Boolean);

  return (
    <KeyboardAvoidingView style={styles.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Yer ara..."
            placeholderTextColor="#999"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (suggestions.length > 0) handleSelect(suggestions[0]);
            }}
          />
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.cancel}>İptal</Text>
          </TouchableOpacity>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderSectionHeader={({ section }) => (
            section.data.length ? <Text style={styles.section}>{section.title}</Text> : null
          )}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
              <Text style={styles.itemText}>{item.description}</Text>
            </TouchableOpacity>
          )}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#fff',
  },
  overlay: {
    flex: 1,
    paddingTop: 50,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fff',
    elevation: 10,
  },
  cancel: {
    marginLeft: 12,
    fontSize: 16,
    color: '#007AFF',
  },
  section: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginLeft: 16,
    color: '#444',
  },
  item: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemText: {
    fontSize: 16,
    color: '#000',
  },
});
