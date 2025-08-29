// components/GetDirectionsOverlay.js
import React, { useEffect, useRef, useState, useMemo } from 'react';
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

const MAX_HISTORY = 20;

/* ---------- helpers ---------- */
function distanceMeters(origin, loc) {
  if (!origin || !loc) return null;
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const lat1 = origin.latitude, lon1 = origin.longitude;
  const lat2 = loc.lat || loc.latitude, lon2 = loc.lng || loc.longitude;
  if (!lat2 || !lon2) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const labelOf = (x) => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  return (
    x.description ||
    x.name ||
    x?.structured_formatting?.main_text ||
    x.address ||
    'Seçilen yer'
  );
};

const subOf = (x) => {
  if (!x || typeof x === 'string') return '';
  return x.address || x?.structured_formatting?.secondary_text || '';
};

const keyOf = (x, i = 0) => {
  if (!x) return `k_${i}`;
  if (typeof x === 'string') return `s_${x}_${i}`;
  const pid = x.place_id || x.id || x.key;
  if (pid) return String(pid);
  const lat =
    x?.coords?.latitude ??
    x?.geometry?.location?.lat ??
    x?.lat;
  const lng =
    x?.coords?.longitude ??
    x?.geometry?.location?.lng ??
    x?.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${Math.round(lat * 1e6)}_${Math.round(lng * 1e6)}`;
  }
  return `k_${i}`;
};

const normalizeEntry = (x) => {
  if (!x) return null;

  if (typeof x === 'string') {
    // eski kayıt: sadece yazı
    return {
      description: x,
      address: '',
      place_id: null,
      coords: undefined,
    };
  }

  // ortak alanlar
  const lat =
    x?.coords?.latitude ??
    x?.geometry?.location?.lat ??
    x?.lat;
  const lng =
    x?.coords?.longitude ??
    x?.geometry?.location?.lng ??
    x?.lng;

  const coords =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : undefined;

  return {
    ...x,
    description:
      x.description || x.name || x.address || x?.structured_formatting?.main_text || 'Seçilen yer',
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
  historyKey,   // ör: 'search_history', 'search_history_from', 'search_history_to'
  favoritesKey, // opsiyonel
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState([]);     // normalized
  const [favorites, setFavorites] = useState([]); // normalized
  const [suggestions, setSuggestions] = useState([]); // {place_id, description, structured_formatting}

  // FROM mu TO mu — sadece debug/okunabilirlik için
  const which = useMemo(() => (onToSelected ? 'to' : 'from'), [onToSelected]);

  /* focus + storage load */
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    let mounted = true;

    const load = async () => {
      try {
        const rawH = historyKey ? await AsyncStorage.getItem(historyKey) : null;
        const rawF = favoritesKey ? await AsyncStorage.getItem(favoritesKey) : null;

        const arrH = rawH ? JSON.parse(rawH) : [];
        const arrF = rawF ? JSON.parse(rawF) : [];

        if (!mounted) return;

        const normH = (Array.isArray(arrH) ? arrH : [])
          .slice(0, MAX_HISTORY)
          .map(normalizeEntry)
          .filter(Boolean);

        const normF = (Array.isArray(arrF) ? arrF : [])
          .map(normalizeEntry)
          .filter(Boolean);

        setHistory(normH);
        setFavorites(normF);
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
      // ✅ location + radius ekle
      const preds = await autocomplete(query.trim(), userCoords);

      if (!active) return;

      // normalize
      let items = preds.map(p => ({
        key: p.place_id,
        place_id: p.place_id,
        description: p.description,
        structured_formatting: p.structured_formatting,
        geometry: p.geometry, // bazı API yanıtlarında gelebilir
      }));

      // ✅ custom scoring: isim benzerliği + mesafe
      const qLower = query.trim().toLowerCase();
      items.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        // isim benzerliği
        const textA = (a.description || "").toLowerCase();
        const textB = (b.description || "").toLowerCase();
        if (textA.startsWith(qLower)) scoreA += 2;
        else if (textA.includes(qLower)) scoreA += 1;
        if (textB.startsWith(qLower)) scoreB += 2;
        else if (textB.includes(qLower)) scoreB += 1;

        // mesafe (yakına +)
        if (userCoords) {
          const distA = distanceMeters(userCoords, a.geometry?.location);
          const distB = distanceMeters(userCoords, b.geometry?.location);
          if (distA != null) scoreA += distA < 5000 ? 1 : 0; // 5 km içindeyse puan
          if (distB != null) scoreB += distB < 5000 ? 1 : 0;
        }

        return scoreB - scoreA; // büyükten küçüğe
      });

      setSuggestions(items);
    } catch (e) {
      if (active) setSuggestions([]);
    }
  };
  run();
  return () => { active = false; };
}, [query, userCoords]);

  const emitSelection = (selected) => {
    if (onToSelected) onToSelected(selected);
    else if (onFromSelected) onFromSelected(selected);
  };

  const resolveByPlaceId = async (placeId, fallbackLabel) => {
    if (!placeId) return null;
    try {
      const details = await getPlaceDetails(placeId);
      const coord = normalizeCoord(
        details?.coords ?? details?.geometry?.location ?? details
      );
      if (!coord) return null;
      return {
        key: placeId,
        description: details?.name || fallbackLabel || 'Seçilen yer',
        coords: coord,
      };
    } catch {
      return null;
    }
  };

  const handleSelectItem = async (item) => {
    Keyboard.dismiss();

    // "Konumunuz"
    if (item?.key === 'current') {
      const c = normalizeCoord(userCoords);
      if (!c) return;
      emitSelection({ key: 'current', description: 'Konumunuz', coords: c });
      return;
    }

    // "Haritadan Seç"
    if (item?.key === 'map') {
      onCancel?.();
      onMapSelect?.();
      return;
    }

    // Geçmiş/Favori/Öneri — normalize et
    const hist = normalizeEntry(item);

    // 1) Koordinatı zaten varsa direkt gönder
    const hasCoords =
      !!hist?.coords ||
      (Number.isFinite(hist?.geometry?.location?.lat) &&
        Number.isFinite(hist?.geometry?.location?.lng));

    if (hasCoords) {
      const coord = hist.coords || normalizeCoord(hist.geometry.location);
      emitSelection({
        key: hist.place_id || hist.key || keyOf(hist),
        description: labelOf(hist),
        coords: coord,
      });
      return;
    }

    // 2) place_id varsa details ile çöz
    if (hist?.place_id) {
      const resolved = await resolveByPlaceId(hist.place_id, labelOf(hist));
      if (resolved) { emitSelection(resolved); return; }
    }

    // 3) String / eski kayıt: önce autocomplete ile place_id bulmayı dene
    if (typeof item === 'string' || typeof hist?.description === 'string') {
      const text = typeof item === 'string' ? item : hist.description;
      try {
        const preds = await autocomplete(text);
        const pid = preds?.[0]?.place_id;
        if (pid) {
          const resolved = await resolveByPlaceId(pid, text);
          if (resolved) { emitSelection(resolved); return; }
        }
      } catch {}
    }

    // 4) En kötü ihtimal — sadece label ile gönder (senin seçici hook’un halleder)
    emitSelection({
      key: hist?.place_id || hist?.key || keyOf(hist),
      description: labelOf(hist),
      coords: undefined,
    });
  };

  const sections = useMemo(() => {
    const q = query.trim();
    const arr = [];
    if (q.length >= 2 && suggestions.length) {
      arr.push({ title: 'Öneriler', data: suggestions });
    }
    if (!q && favorites.length) {
      arr.push({ title: 'Favoriler', data: favorites });
    }
    if (!q && history.length) {
      arr.push({ title: 'Geçmiş', data: history });
    }
    return arr;
  }, [query, suggestions, favorites, history]);

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
            placeholder={which === 'to' ? 'Nereye?' : 'Nereden?'}
            placeholderTextColor="#888"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          <TouchableOpacity onPress={onCancel} accessibilityLabel="Kapat">
            <Text style={styles.cancel}>X</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.quickRow}>
          {available && (
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => handleSelectItem({ key: 'current' })}
              activeOpacity={0.7}
            >
              <Text style={styles.quickText}>Konumunuz</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.quickButton}
            onPress={() => handleSelectItem({ key: 'map' })}
            activeOpacity={0.7}
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
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() => handleSelectItem(item)}
              activeOpacity={0.8}
              key={keyOf(item, index)}
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
