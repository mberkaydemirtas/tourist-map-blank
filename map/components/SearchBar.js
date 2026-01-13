import React, { useEffect, useState, useRef, forwardRef, useMemo } from 'react';
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
  BackHandler,
  TouchableWithoutFeedback,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete } from '../maps';
import { Ionicons } from '@expo/vector-icons';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 5;

function normalizeCenter(center) {
  if (!center) return null;
  const lat = Number(center.lat ?? center.latitude);
  const lng = Number(center.lng ?? center.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const SearchBar = forwardRef(
  (
    {
      value = '',
      onChange,
      onSelect,

      // ✅ NEW: MapHeaderControls üzerinden gelecek
      searchCountryCode,     // 'pl' | 'tr' | undefined
      searchLanguage = 'tr', // 'tr' | 'en' | 'pl'...
      searchBiasCenter,      // {lat,lng} veya {latitude,longitude}
      searchRadius,          // metre
    },
    ref
  ) => {
    const [suggestions, setSuggestions] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [focused, setFocused] = useState(false);

    const inputRef = ref || useRef();

    // 🔧 autocomplete opts (tek yerden yönet)
    const acOpts = useMemo(() => {
      const c = normalizeCenter(searchBiasCenter);
      const lat = c?.lat;
      const lng = c?.lng;

      return {
        country: searchCountryCode || undefined,
        language: searchLanguage || 'tr',
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        radius: Number.isFinite(searchRadius) ? searchRadius : undefined,
        strict: false,
      };
    }, [searchCountryCode, searchLanguage, searchBiasCenter, searchRadius]);

    // Load history
    useEffect(() => {
      (async () => {
        try {
          const stored = await AsyncStorage.getItem(HISTORY_KEY);
          if (stored) setHistory(JSON.parse(stored));
        } catch {
          console.warn('Failed to load history');
        }
      })();
    }, []);

    // Autocomplete
    useEffect(() => {
      if (value?.length < 2) {
        setSuggestions([]);
        return;
      }

      const handler = setTimeout(async () => {
        setLoading(true);
        setError(null);
        try {
          const preds = await autocomplete(value, acOpts);
          setSuggestions(Array.isArray(preds) ? preds : []);
        } catch {
          setSuggestions([]);
          setError('Search failed.');
        } finally {
          setLoading(false);
        }
      }, 300);

      return () => clearTimeout(handler);
    }, [value, acOpts]);

    // Save to history
    const saveToHistory = async (desc) => {
      try {
        const newHistory = [desc, ...history.filter((item) => item !== desc)].slice(0, MAX_HISTORY);
        setHistory(newHistory);
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
      } catch {
        console.warn('Failed to save history');
      }
    };

    // Handle selection
    const handleSelect = async (place_id, description) => {
      try {
        // history item formatı: { place_id: item, description: item }
        // burada place_id === description olunca "yeniden bulma" yapıyorsun
        if (place_id === description) {
          const matches = await autocomplete(description, acOpts);
          const found = (matches || []).find((x) => x.description === description);

          // Bazı durumlarda description birebir match olmayabilir → fallback: ilk sonucu al
          const picked = found || (matches && matches[0]);

          if (!picked) throw new Error();

          saveToHistory(picked.description);
          onSelect(picked.place_id, picked.description);
        } else {
          saveToHistory(description);
          onSelect(place_id, description);
        }
      } catch {
        Alert.alert(
          'Error',
          place_id === description
            ? 'Could not re-find that history location.'
            : 'Cannot reach Google servers.'
        );
      } finally {
        inputRef.current?.blur();
      }
    };

    // Merged suggestions or history
    const merged = focused
      ? value?.length < 2
        ? history.map((item) => ({ place_id: item, description: item }))
        : suggestions
      : [];

    // Back button to blur
    useEffect(() => {
      const onBack = () => {
        if (focused) {
          inputRef.current?.blur();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [focused]);

    return (
      <>
        {focused && (
          <TouchableWithoutFeedback onPress={() => inputRef.current?.blur()}>
            <View style={styles.overlay} />
          </TouchableWithoutFeedback>
        )}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.container}
        >
          <View style={styles.searchBox}>
            <TouchableOpacity onPress={() => inputRef.current?.focus()}>
              <Ionicons name="search" size={20} color="#888" style={styles.icon} />
            </TouchableOpacity>

            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Bir yer ara"
              placeholderTextColor="#888"
              value={value}
              onChangeText={onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />

            {value?.length > 0 && (
              <TouchableOpacity onPress={() => onChange('')}>
                <Text style={styles.clear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {loading && <ActivityIndicator style={styles.loader} />}
          {error && <Text style={styles.error}>{error}</Text>}

          {merged.length > 0 && (
            <View style={styles.suggestionBox}>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={merged}
                keyExtractor={(item) => item.place_id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.item}
                    onPress={() => handleSelect(item.place_id, item.description)}
                  >
                    <Text style={styles.itemText}>{item.description}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </>
    );
  }
);

export default SearchBar;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 20 : 40,
    left: 10,
    right: 10,
    zIndex: 1000,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 500,
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
  icon: { marginRight: 8 },
  input: { flex: 1, fontSize: 16, color: '#000' },
  clear: { fontSize: 18, paddingLeft: 10, color: '#888' },
  loader: { marginTop: 5 },
  error: { color: 'red', marginTop: 5, fontSize: 12 },
  suggestionBox: {
    marginTop: 5,
    backgroundColor: '#fff',
    borderRadius: 8,
    maxHeight: 200,
    overflow: 'hidden',
    elevation: 4,
  },
  item: {
    padding: 12,
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
  },
  itemText: { color: '#000' },
});
