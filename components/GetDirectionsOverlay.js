import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  SectionList, KeyboardAvoidingView, StyleSheet, Keyboard, Platform
} from 'react-native';
import { autocomplete } from '../services/maps';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 5;

export default function GetDirectionsOverlay({ userCoords, available, onCancel, onFromSelected }) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    AsyncStorage.getItem(HISTORY_KEY).then(h => setHistory(h ? JSON.parse(h) : []));
  }, []);

  useEffect(() => {
    if (query.length >= 2) {
      autocomplete(query).then(preds => setSuggestions(preds.map(p => ({ key: p.place_id, description: p.description }))));
    } else {
      setSuggestions([]);
    }
  }, [query]);

  const handleSelectItem = async (item) => {
    Keyboard.dismiss();
    if (item.description) {
      const newHistory = [item.description, ...history.filter(h => h !== item.description)].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    }
    onFromSelected(item);
  };

  const showSuggestions = query.length >= 2 && suggestions.length > 0;
  const showHistory = query.length === 0 && history.length > 0;

  const sections = [
    showSuggestions && { title: 'Öneriler', data: suggestions },
    showHistory && { title: 'Geçmiş', data: history.map(h => ({ key: h, description: h, isHistory: true })) },
  ].filter(Boolean);

  return (
    <KeyboardAvoidingView style={styles.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Nereden"
            placeholderTextColor="#999"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => handleSelectItem({ type: 'search', description: query })}
          />
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancel}>X</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Buttons */}
        <View style={styles.quickRow}>
          {available && (
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => handleSelectItem({ key: 'current', coords: userCoords })}
            >
              <Text style={styles.quickText}>Konumunuz</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.quickButton}
            onPress={() => handleSelectItem({ key: 'map' })}
          >
            <Text style={styles.quickText}>Haritadan Seç</Text>
          </TouchableOpacity>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={item => item.key}
          renderSectionHeader={({ section }) => section.data.length ? <Text style={styles.section}>{section.title}</Text> : null}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => handleSelectItem(item)}>
              <Text style={styles.itemText}>{item.isHistory ? '' : ''}{item.description}</Text>
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
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
  },
  overlay: {
    flex: 1,
    backgroundColor: '#fff',
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
  cancel: { marginLeft: 12, fontSize: 18, color: '#007AFF' },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  quickButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  quickText: {
    fontSize: 16,
    color: '#000',
  },
  section: { fontSize: 14, fontWeight: '600', marginTop: 16, marginLeft: 16, color: '#444' },
  item: { padding: 12 },
  itemText: { fontSize: 16, color: '#000' },
});