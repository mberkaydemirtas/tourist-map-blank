// ✅ SearchBar.js — History seçim için handleSelect geliştirildi ve dış tıklama/geri basma kontrolü eklendi
import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Keyboard,
  BackHandler,
  TouchableWithoutFeedback,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete } from '../services/maps';
import { Ionicons } from '@expo/vector-icons';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 5;

export default function SearchBar({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);

  const inputRef = useRef();

  // Geçmişi yükle
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(HISTORY_KEY);
        if (stored) setHistory(JSON.parse(stored));
      } catch {
        console.warn('Geçmiş yüklenemedi');
      }
    })();
  }, []);

  // Autocomplete çağrısı
  useEffect(() => {
    if (value.length < 2) {
      setSuggestions([]);
      return;
    }
    const handler = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const preds = await autocomplete(value);
        setSuggestions(preds);
      } catch {
        setSuggestions([]);
        setError('Arama başarısız oldu.');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [value]);

  // History kaydet
  const saveToHistory = async (description) => {
    try {
      const newHistory = [
        description,
        ...history.filter(item => item !== description),
      ].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch {
      console.warn('Geçmişe kaydedilemedi');
    }
  };

  // Seçim işlemi
  const handleSelect = async (place_id, description) => {
    try {
      if (place_id === description) {
        const matches = await autocomplete(description);
        const found = matches.find(x => x.description === description);
        if (!found) throw new Error();
        saveToHistory(found.description);
        onSelect(found.place_id, found.description);
      } else {
        saveToHistory(description);
        onSelect(place_id, description);
      }
    } catch {
      Alert.alert('Hata', place_id === description ? 'Geçmiş konumu yeniden bulamadık.' : 'Google sunucusuna ulaşılamadı.');
    } finally {
      inputRef.current?.blur();
    }
  };

  // Focus durumuna göre history veya suggestions
  const mergedSuggestions = focused
    ? (value.length < 2
        ? history.map(item => ({ place_id: item, description: item }))
        : suggestions)
    : [];

  // Hardware back tuşunu yakala
  useEffect(() => {
    const onBackPress = () => {
      if (focused) {
        inputRef.current?.blur();
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [focused]);

  return (
    <>
      {/* Dış tıklama yakalama katmanı */}
      {focused && (
        <TouchableWithoutFeedback onPress={() => inputRef.current?.blur()}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.searchContainer}
      >
        <View style={styles.searchBox}>
          <TouchableOpacity onPress={() => inputRef.current?.focus()}>
            <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Bir yer ara"
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {value.length > 0 && (
            <TouchableOpacity onPress={() => onChange('')}>
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && <ActivityIndicator style={styles.loader} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {mergedSuggestions.length > 0 && (
          <View style={styles.suggestionBox}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={mergedSuggestions}
              keyExtractor={item => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSelect(item.place_id, item.description)}
                >
                  <Text>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute', top: Platform.OS === 'android' ? 20 : 40, left: 10, right: 10, zIndex: 1000,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', zIndex: 500,
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 5, elevation: 5,
  },
  searchIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 16 },
  clearText: { fontSize: 18, paddingLeft: 10, color: '#888' },
  loader: { marginTop: 5 },
  error: { color: 'red', marginTop: 5, fontSize: 12 },
  suggestionBox: { marginTop: 5, backgroundColor: '#fff', borderRadius: 8, maxHeight: 200, overflow: 'hidden', elevation: 4 },
  suggestionItem: { padding: 12, borderBottomColor: '#eee', borderBottomWidth: 1 },
});
