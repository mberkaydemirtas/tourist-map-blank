// components/GetDirectionsOverlay.js
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete, getPlaceDetails } from '../maps';
import { toCoordsObject, normalizeCoord } from '../utils/coords';

const HISTORY_KEY_BASE = 'search_history';
const MAX_HISTORY = 5;

export default function GetDirectionsOverlay({
  userCoords,
  onFromSelected,
  onToSelected,
  available,
  refreshLocation,
  onCancel,
  onMapSelect,
  historyKey,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    const key = historyKey || HISTORY_KEY_BASE;
    AsyncStorage.getItem(key).then(h => setHistory(h ? JSON.parse(h) : []));
  }, [historyKey]);

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

  const handleSelectItem = async item => {
    Keyboard.dismiss();
    let selected = { ...item };
    console.log('🚀 Overlay seçildi (ön):', item);

    // Current location
  if (item.key === 'current') {
    const c = normalizeCoord(userCoords);
    if (!c) {
      console.warn('❌ Geçersiz current location');
      return;
    }
    selected = { key: 'current', description: 'Konumunuz', coords: c };
  }

    // Map-select
    if (item.key === 'map') {
      onCancel();
      onMapSelect();
      return;
    }

    // Öneri veya geçmişten seçim koordinat almak
    if (!selected.coords && item.key !== 'current') {
      try {
        let placeId = selected.key;
        if (item.isHistory) {
          console.log('🔄 History için autocomplete:', selected.description);
          const res = await autocomplete(selected.description);
          if (!res.length) {
            console.warn('❌ Autocomplete sonuc yok:', selected.description);
            return;
          }
          placeId = res[0].place_id;
          selected = { key: placeId, description: res[0].description };
        }
        console.log('📦 Detay almak için placeId:', placeId);
      const details = await getPlaceDetails(placeId);
      const detCoord = normalizeCoord(details?.coords ?? details?.geometry?.location ?? details);
      if (!detCoord) {
        console.warn('❌ Koordinat normalize edilemedi (place details)');
        return;
      }
      selected = { key: placeId, description: selected.description, coords: detCoord };
      } catch (err) {
        console.warn('❌ Koordinat alınamadı:', err);
        return;
      }
    }

    // History kaydet
    if (selected.description && selected.coords) {
      const key = historyKey || HISTORY_KEY_BASE;
      const newHist = [selected.description, ...history.filter(h => h !== selected.description)].slice(0, MAX_HISTORY);
      setHistory(newHist);
      AsyncStorage.setItem(key, JSON.stringify(newHist));
    }

    console.log('✅ Overlay seçimi sonrası final:', selected);
    // Doğru callback'i çağır
    if (onToSelected) {
      onToSelected(selected);
    } else if (onFromSelected) {
      onFromSelected(selected);
    }
  };

  const sections = [
    query.length >= 2 && { title: 'Öneriler', data: suggestions },
    query.length === 0 && history.length > 0 && {
      title: 'Geçmiş',
      data: history.map(desc => ({ key: desc, description: desc, isHistory: true })),
    },
  ].filter(Boolean);

  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Konum Girin"
            placeholderTextColor="#888"
            value={query}
            onChangeText={setQuery}
          />
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancel}>X</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.quickRow}>
          {available && (
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => handleSelectItem({ key: 'current' })}
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
          renderSectionHeader={({ section }) =>
            section.data.length ? <Text style={styles.section}>{section.title}</Text> : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.item} onPress={() => handleSelectItem(item)}>
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
  wrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 },
  overlay: { flex: 1, backgroundColor: '#fff', paddingTop: 50 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
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
  quickRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12, paddingHorizontal: 16 },
  quickButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  quickText: { fontSize: 16, color: '#000' },
  section: { fontSize: 14, fontWeight: '600', marginTop: 16, marginLeft: 16, color: '#444' },
  item: { padding: 12 },
  itemText: { fontSize: 16, color: '#000' },
});
