import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, SectionList, Keyboard } from 'react-native';
import { useLocation } from '../hooks/useLocation';
import SearchBar from '../components/SearchBar';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'search_history';
const FAVORITES_KEY = 'favorite_places';

export default function GetDirectionsScreen({ onFromSelected }) {
  const { coords: userCoords, available } = useLocation();
  const [mode, setMode] = useState('search'); // 'search','current','map','favorites','history'
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const h = await AsyncStorage.getItem(HISTORY_KEY);
      setHistory(h ? JSON.parse(h) : []);
      const f = await AsyncStorage.getItem(FAVORITES_KEY);
      setFavorites(f ? JSON.parse(f) : []);
    })();
  }, []);

  useEffect(() => {
    if (mode === 'search') {
      inputRef.current?.focus();
    }
  }, [mode]);

  const handleSelect = (source) => {
    onFromSelected(source);
    Keyboard.dismiss();
  };

  const sections = [
    available ? { title: 'Konumunuz', data: [{ key: 'current' }] } : null,
    { title: 'Haritada Seç', data: [{ key: 'map' }] },
    favorites.length ? { title: 'Favoriler', data: favorites.map(place => ({ key: place.id, place })) } : null,
    history.length ? { title: 'Geçmiş', data: history.map(desc => ({ key: desc, description: desc })) } : null,
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Nereden gitmek istiyorsunuz?</Text>

      <SectionList
        sections={sections}
        keyExtractor={item => item.key}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => {
          if (item.key === 'current') {
            return (
              <TouchableOpacity style={styles.option} onPress={() => handleSelect({ type: 'current', coords: userCoords })}>
                <Text style={styles.optionText}>Konumunuz</Text>
              </TouchableOpacity>
            );
          }
          if (item.key === 'map') {
            return (
              <TouchableOpacity style={styles.option} onPress={() => handleSelect({ type: 'map' })}>
                <Text style={styles.optionText}>Haritada Seç</Text>
              </TouchableOpacity>
            );
          }
          if (item.place) {
            return (
              <TouchableOpacity style={styles.option} onPress={() => handleSelect({ type: 'favorite', place: item.place })}>
                <Text style={styles.optionText}>{item.place.name}</Text>
              </TouchableOpacity>
            );
          }
          if (item.description) {
            return (
              <TouchableOpacity style={styles.option} onPress={() => handleSelect({ type: 'history', description: item.description })}>
                <Text style={styles.optionText}>{item.description}</Text>
              </TouchableOpacity>
            );
          }
          return null;
        }}
      />

      {mode === 'search' && (
        <SearchBar
          ref={inputRef}
          value={searchQuery}
          onChange={setSearchQuery}
          onSelect={(placeId, description) => handleSelect({ type: 'search', placeId, description })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  header: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#444', marginTop: 16, marginBottom: 4 },
  option: { paddingVertical: 10 },
  optionText: { fontSize: 16, color: '#000' },
});
