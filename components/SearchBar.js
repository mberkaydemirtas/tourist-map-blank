// ✅ Modern UX/UI'li SearchBar.js
import React, { useEffect, useState } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { autocomplete } from '../services/maps';

export default function SearchBar({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (value.length < 2) {
        setSuggestions([]);
        setLoading(false);
        setError(null);
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.searchContainer}
    >
      <View style={styles.searchBox}>
        <TextInput
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

      {suggestions.length > 0 && (
        <View style={styles.suggestionBox}>
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={suggestions}
            keyExtractor={item => item.place_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionItem}
                onPress={() => onSelect(item.place_id, item.description)}
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