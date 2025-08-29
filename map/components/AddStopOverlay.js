// components/AddStopOverlay.js
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, SafeAreaView, KeyboardAvoidingView, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autocomplete } from '../maps';

const CATEGORIES = [
  { key: 'gas_station', label: '⛽ Benzin' },
  { key: 'restaurant',  label: '🍽️ Restoran' },
  { key: 'supermarket', label: '🛒 Market' },
  { key: 'atm',         label: '🏧 ATM' },
  { key: 'cafe',        label: '☕ Kafe' },
  { key: 'pharmacy',    label: '💊 Eczane' },
];

const BRANDS = [
  'Shell','OPET','BP','Total','Starbucks',"McDonald's",
  'Burger King','CarrefourSA','Migros'
];

const STORAGE_KEY = 'addstop_history_v1';
const DEBOUNCE_MS = 250;

export default function AddStopOverlay({
  visible,
  onClose,
  onCategorySelect,
  onQuerySubmit,
  onPickStop,
  onAddStop,
  // routeBounds // ❌ artık kullanılmıyor
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sugs, setSugs] = useState([]);
  const [history, setHistory] = useState([]);
  const timerRef = useRef(null);

  const showSugs = visible && query.trim().length >= 2;

  const brandSugs = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (t.length < 2) return [];
    return BRANDS
      .filter(b => b.toLowerCase().startsWith(t))
      .slice(0, 4)
      .map(name => ({ __brand: true, description: name }));
  }, [query]);

  useEffect(() => {
    if (visible) {
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEY);
          const arr = raw ? JSON.parse(raw) : [];
          setHistory(Array.isArray(arr) ? arr.slice(0, 8) : []);
        } catch { setHistory([]); }
      })();
    } else {
      setQuery('');
      setSugs([]);
      setLoading(false);
    }
  }, [visible]);

  const saveHistory = useCallback(async (text) => {
    try {
      const norm = String(text || '').trim();
      if (!norm) return;
      const next = [norm, ...history.filter(x => x !== norm)].slice(0, 8);
      setHistory(next);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [history]);

  const doAutocomplete = useCallback(async (q) => {
    const t = String(q || '').trim();
    if (!visible || t.length < 2) { setSugs([]); return; }
    setLoading(true);
    try {
      // ✅ bounds kaldırıldı; koridor kısıtı yok
      const items = await autocomplete(t, { types: 'establishment' });
      const list = Array.isArray(items) ? items.slice(0, 8) : [];
      setSugs(list);
    } catch {
      setSugs([]);
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doAutocomplete(query), DEBOUNCE_MS);
    return () => timerRef.current && clearTimeout(timerRef.current);
  }, [query, doAutocomplete, visible]);

  const chooseCategory = (type) => {
    onClose?.();
    onCategorySelect?.(type);
  };

  const submitText = async (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    await saveHistory(t);
    onClose?.();
    // Bu yol, koridor taraması yapan dış fonksiyonu çağırır (istenirse)
    onQuerySubmit?.(t);
  };

  // ✅ Geçmiş chip tıklama: hızlı seçim (autocomplete → ilk sonuç → direkt Ekle)
  const handleHistoryTap = async (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    try {
      const preds = await autocomplete(t); // bounds yok
      const first = preds?.[0];
      if (first) {
        await saveHistory(t);
        onClose?.();
        onAddStop?.(first); // useStopsEditor hızlı pan + ekleme yapar
      } else {
        // hiç sonuç yoksa eski davranışa düşelim
        await submitText(t);
      }
    } catch {
      await submitText(t);
    }
  };

  const combinedSuggestions = useMemo(() => {
    if (!showSugs) return [];
    const map = new Map();
    [...brandSugs, ...sugs].forEach((it, idx) => {
      const key = it?.place_id || it?.description || it?.name || String(idx);
      if (!map.has(key)) map.set(key, it);
    });
    return Array.from(map.values());
  }, [showSugs, brandSugs, sugs]);

  const renderChip = ({ item }) => (
    <TouchableOpacity style={styles.bigChip} onPress={() => chooseCategory(item.key)}>
      <Text style={styles.bigChipText}>{item.label}</Text>
    </TouchableOpacity>
  );

  const renderSuggestion = ({ item }) => {
    const isBrand = !!item.__brand;
    const title = item?.structured_formatting?.main_text || item?.description || item?.name || 'Öneri';
    const sub   = isBrand ? 'Marka kısayolu' : (item?.structured_formatting?.secondary_text || '');
    const text  = item?.description || title;
    return (
      <View style={styles.sugRow}>
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={async () => {
            await saveHistory(text);
            if (isBrand) {
              submitText(text);
            } else {
              onPickStop?.(item); // aday olarak seç (harita pan’ı hook’ta)
              onClose?.();
            }
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.sugTitle} numberOfLines={1}>{title}</Text>
            {!!sub && <Text style={styles.sugSub} numberOfLines={1}>{sub}</Text>}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={async () => {
            await saveHistory(text);
            onAddStop?.(item);  // doğrudan ekle (hızlı pan + recalc hook’ta)
            onClose?.();
          }}
        >
          <Text style={styles.sugCta}>Seç</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeTxt}>Kapat</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Durak ekle</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Search Bar */}
          <View style={styles.searchBox}>
            <View style={styles.inputWrap}>
              <TextInput
                placeholder="Yer veya kategori ara (örn. kafe, Shell, ATM...)"
                placeholderTextColor="#888"
                value={query}
                onChangeText={setQuery}
                autoFocus
                style={styles.input}
                returnKeyType="search"
                onSubmitEditing={() => submitText(query)}
              />
              {loading ? (
                <ActivityIndicator style={styles.inputRight} />
              ) : query.length > 0 ? (
                <TouchableOpacity style={styles.inputRight} onPress={() => setQuery('')}>
                  <Text style={{ color: '#888', fontSize: 13 }}>Temizle</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Kategori çipleri */}
          <View style={styles.categories}>
            <FlatList
              data={CATEGORIES}
              keyExtractor={(i) => i.key}
              renderItem={renderChip}
              numColumns={3}
              columnWrapperStyle={{ justifyContent: 'space-between', marginBottom: 12 }}
              contentContainerStyle={{ paddingBottom: 8 }}
            />
            <TouchableOpacity style={styles.clearBtn} onPress={() => chooseCategory(null)}>
              <Text style={styles.clearBtnText}>Kategori filtrelerini temizle</Text>
            </TouchableOpacity>
          </View>

          {/* Öneriler / Geçmiş */}
          <View style={styles.historyWrap}>
            <Text style={styles.sectionTitle}>{showSugs ? 'Öneriler' : 'Geçmiş'}</Text>

            {showSugs ? (
              loading && combinedSuggestions.length === 0 ? (
                <View style={{ paddingVertical: 12 }}><ActivityIndicator /></View>
              ) : (
                <FlatList
                  data={combinedSuggestions}
                  keyExtractor={(it, idx) => it?.place_id || it?.description || it?.name || String(idx)}
                  renderItem={renderSuggestion}
                  ItemSeparatorComponent={() => <View style={styles.sep} />}
                  keyboardShouldPersistTaps="handled"
                />
              )
            ) : (
              history.length === 0 ? (
                <Text style={styles.emptyText}>Henüz arama geçmişi yok</Text>
              ) : (
                <View style={styles.historyChips}>
                  {history.map((h) => (
                    <TouchableOpacity key={h} style={styles.histChip} onPress={() => handleHistoryTap(h)}>
                      <Text style={styles.histChipText}>{h}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  closeBtn: { width: 60, paddingVertical: 6 },
  closeTxt: { fontSize: 16, color: '#007AFF' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#111' },

  searchBox: { paddingHorizontal: 12, paddingBottom: 8 },
  inputWrap: { position: 'relative' },
  input: {
    height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#d9d9d9',
    paddingHorizontal: 14, paddingRight: 70, fontSize: 16, backgroundColor: '#fff', color: '#111',
  },
  inputRight: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },

  sugRow: { paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  sugTitle: { fontSize: 15, fontWeight: '600', color: '#111' },
  sugSub: { fontSize: 12, color: '#666', marginTop: 2 },
  sugCta: { fontSize: 13, fontWeight: '700', color: '#007AFF', marginLeft: 8 },
  sep: { height: 1, backgroundColor: '#f3f3f3', marginLeft: 12 },

  categories: { paddingHorizontal: 12, paddingTop: 12 },
  bigChip: {
    flex: 1, height: 56, marginHorizontal: 4, borderRadius: 14,
    backgroundColor: '#0B84FF', alignItems: 'center', justifyContent: 'center', elevation: 2,
  },
  bigChipText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  clearBtn: { marginTop: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 8 },
  clearBtnText: { color: '#007AFF', fontWeight: '600', fontSize: 13 },

  historyWrap: { paddingHorizontal: 12, paddingTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 6 },
  emptyText: { fontSize: 12, color: '#777' },
  historyChips: { flexDirection: 'row', flexWrap: 'wrap' },
  histChip: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#f1f5f9',
    marginRight: 8, marginBottom: 8
  },
  histChipText: { fontSize: 13, color: '#111', fontWeight: '600' },
});
