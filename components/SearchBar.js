// ✅ SearchBar.js — Geçmiş aramalar (history) entegre edildi 
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

  const inputRef = useRef();

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Geçmiş yüklenemedi');
    }
  };

  const saveToHistory = async (description) => {
    try {
      const newHistory = [description, ...history.filter(item => item !== description)].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.warn('Geçmişe kaydedilemedi');
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      if (value.length < 2) {
        setSuggestions([]);
        return;
      }

      const fetch = async () => {
        setLoading(true);
        setError(null);
        try {
          const preds = await autocomplete(value);
          setSuggestions(preds);
        } catch (e) {
          setSuggestions([]);
          setError('Arama başarısız oldu.');
        } finally {
          setLoading(false);
        }
      };

      fetch();
    }, 300);

    return () => clearTimeout(handler);
  }, [value]);

  const handleSelect = async (place_id, description) => {
    if (place_id === description) {
      try {
        const matches = await autocomplete(description);
        const found = matches.find((x) => x.description === description);
        if (found) {
          saveToHistory(found.description);
          onSelect(found.place_id, found.description);
        } else {
          Alert.alert('Hata', 'Geçmiş konumu yeniden bulamadık.');
        }
      } catch (e) {
        Alert.alert('Hata', 'Google sunucusuna ulaşılamadı.');
      }
    } else {
      saveToHistory(description);
      onSelect(place_id, description);
    }
  };

  const mergedSuggestions = value.length < 2
    ? history.map(item => ({ place_id: item, description: item }))
    : suggestions;

  return (
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
            keyExtractor={(item) => item.place_id}
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
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 10,
    right: 10,
    zIndex: 1000,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  clearText: {
    fontSize: 18,
    paddingLeft: 10,
    color: '#888',
  },
  loader: {
    marginTop: 5,
  },
  error: {
    color: 'red',
    marginTop: 5,
    fontSize: 12,
  },
  suggestionBox: {
    marginTop: 5,
    backgroundColor: '#fff',
    borderRadius: 8,
    maxHeight: 200,
    overflow: 'hidden',
    elevation: 4,
  },
  suggestionItem: {
    padding: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
});
