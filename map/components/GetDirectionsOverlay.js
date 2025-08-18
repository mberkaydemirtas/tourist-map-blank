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
import { normalizeCoord } from '../utils/coords';

const HISTORY_KEY_BASE = 'search_history';
const MAX_HISTORY = 20;

/* ---------- helpers ---------- */
const labelOf = (x) => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  return (
    x.description ||
    x.name ||
    x?.structured_formatting?.main_text ||
    x?.address ||
    'Seçilen yer'
  );
};
const subOf = (x) => {
  if (!x || typeof x === 'string') return '';
  return x.address || x?.structured_formatting?.secondary_text || '';
};
const keyOf = (x, i) => {
  if (!x) return `k_${i}`;
  if (typeof x === 'string') return `s_${x}_${i}`;
  const pid = x.place_id || x.id || x.key;
  if (pid) return String(pid);
  const lat = x?.coords?.latitude ?? x?.geometry?.location?.lat ?? x?.lat;
  const lng = x?.coords?.longitude ?? x?.geometry?.location?.lng ?? x?.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${Math.round(lat * 1e6)}_${Math.round(lng * 1e6)}`;
  }
  return `k_${i}`;
};
const normalizeEntry = (x) => {
  if (!x) return null;
  if (typeof x === 'string') {
    return {
      description: x,
      address: '',
      place_id: null,
      coords: undefined,
    };
  }
  // Şema uyumlama
  const lat =
    x?.coords?.latitude ??
    x?.geometry?.location?.lat ??
    x.lat;
  const lng =
    x?.coords?.longitude ??
    x?.geometry?.location?.lng ??
    x.lng;

  const coords =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : undefined;

  return {
    ...x,
    description: x.description || x.name || x.address || 'Seçilen yer',
    address: x.address || x?.structured_formatting?.secondary_text || '',
    place_id: x.place_id || x.id || x.key || null,
    coords,
  };
};

export default function GetDirectionsOverlay({
  userCoords,
  onFromSelected,
  onToSelected,
  available,
  refreshLocation,
  onCancel,
  onMapSelect,
  historyKey,
  favoritesKey, // MapScreen bazen gönderiyor
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState([]);     // normalized objects
  const [favorites, setFavorites] = useState([]); // optional
  const [suggestions, setSuggestions] = useState([]); // preds

  /* focus + storage load */
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    let mounted = true;

    const load = async () => {
      try {
        const hKey = historyKey || HISTORY_KEY_BASE;
        const rawH = await AsyncStorage.getItem(hKey);
        const rawF = favoritesKey ? await AsyncStorage.getItem(favoritesKey) : null;

        const arrH = rawH ? JSON.parse(rawH) : [];
        const arrF = rawF ? JSON.parse(rawF) : [];

        if (!mounted) return;
        setHistory(Array.isArray(arrH) ? arrH.map(normalizeEntry).filter(Boolean) : []);
        setFavorites(Array.isArray(arrF) ? arrF.map(normalizeEntry).filter(Boolean) : []);
      } catch {
        if (!mounted) return;
        setHistory([]);
        setFavorites([]);
      }
    };

    load();
    return () => { mounted = false; };
  }, [historyKey, favoritesKey]);

  /* autocomplete */
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const preds = await autocomplete(query.trim());
        if (!active) return;
        const items = preds.map(p => ({
          key: p.place_id,
          place_id: p.place_id,
          description: p.description,
          structured_formatting: p.structured_formatting,
        }));
        setSuggestions(items);
      } catch {
        if (active) setSuggestions([]);
      }
    };
    run();
    return () => { active = false; };
  }, [query]);

  const emitSelection = (selected) => {
    // Önce To, yoksa From
    if (onToSelected) onToSelected(selected);
    else if (onFromSelected) onFromSelected(selected);
  };

  const handleSelectItem = async (item) => {
    Keyboard.dismiss();

    // current location
    if (item?.key === 'current') {
      const c = normalizeCoord(userCoords);
      if (!c) return;
      emitSelection({ key: 'current', description: 'Konumunuz', coords: c });
      return;
    }

    // map select
    if (item?.key === 'map') {
      onCancel?.();
      onMapSelect?.();
      return;
    }

    // HISTORY / FAVORITES nesneleri: elden geldiğince direkt kullan
    const hist = normalizeEntry(item);
    const hasCoords =
      !!hist?.coords ||
      Number.isFinite(hist?.geometry?.location?.lat) &&
      Number.isFinite(hist?.geometry?.location?.lng);

    if (hasCoords) {
      const coord =
        hist.coords ||
        normalizeCoord(hist.geometry.location);
      emitSelection({
        key: hist.place_id || hist.key || keyOf(hist),
        description: labelOf(hist),
        coords: coord,
      });
      return;
    }

    // ÖNERİ/STRING: place details ile koordinat çek
    try {
      let placeId = hist.place_id || hist.key;
      // Sadece string eski kayıt ise önce autocomplete dene
      if (!placeId && typeof item === 'string') {
        const preds = await autocomplete(item);
        placeId = preds?.[0]?.place_id;
      }
      if (!placeId) return;

      const details = await getPlaceDetails(placeId);
      const detCoord = normalizeCoord(
        details?.coords ?? details?.geometry?.location ?? details
      );
      if (!detCoord) return;

      emitSelection({
        key: placeId,
        description: labelOf(hist) || details?.name || 'Seçilen yer',
        coords: detCoord,
      });

      // Not: Storage'a yazmayı MapScreen yapıyor; overlay yazmaz.
    } catch (e) {
      // sessiz geç
    }
  };

  const sections = [
    query.trim().length >= 2 && { title: 'Öneriler', data: suggestions },
    !query && favorites.length > 0 && { title: 'Favoriler', data: favorites },
    !query && history.length > 0 && { title: 'Geçmiş', data: history },
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
            placeholder="Konum girin"
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
          keyExtractor={(item, i) => keyOf(item, i)}
          renderSectionHeader={({ section }) =>
            section.data.length ? (
              <Text style={styles.section}>{section.title}</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() => handleSelectItem(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.itemText} numberOfLines={1}>
                {labelOf(item)}
              </Text>
              {!!subOf(item) && (
                <Text style={styles.itemSub} numberOfLines={1}>
                  {subOf(item)}
                </Text>
              )}
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
  item: { paddingVertical: 10, paddingHorizontal: 16 },
  itemText: { fontSize: 16, color: '#000' },
  itemSub: { fontSize: 12, color: '#666', marginTop: 2 },
});
