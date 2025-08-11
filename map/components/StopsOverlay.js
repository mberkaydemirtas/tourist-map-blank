import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { MaterialIcons } from '@expo/vector-icons';
import { getNearbyPlaces, getPlaceDetails } from '../maps';

const DEFAULT_CATEGORIES = [
  { key: 'cafe', label: 'Kafe', icon: 'local-cafe' },
  { key: 'restaurant', label: 'Restoran', icon: 'restaurant' },
  { key: 'gas_station', label: 'Benzin', icon: 'local-gas-station' },
  { key: 'supermarket', label: 'Market', icon: 'shopping-cart' },
  { key: 'atm', label: 'ATM', icon: 'atm' },
  { key: 'pharmacy', label: 'Eczane', icon: 'local-pharmacy' },
];

export default function StopsOverlay({
  visible,
  onClose,
  mapCenter,        // { latitude, longitude }
  radius = 2500,    // metre
  onAddStop,        // (placeDetail) => void
}) {
  const sheetRef = useRef(null);
  const snapPoints = useMemo(() => ['40%', '85%'], []);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('cafe');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (visible) {
      handleSearchCategory(activeCat);
      sheetRef.current?.expand?.();
    } else {
      sheetRef.current?.close?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSearchCategory = useCallback(async (catOrText) => {
    if (!mapCenter?.latitude) return;
    setLoading(true);
    const type = DEFAULT_CATEGORIES.find(c => c.key === catOrText)?.key || activeCat;
    const kw = DEFAULT_CATEGORIES.find(c => c.key === catOrText) ? undefined : String(catOrText || '').trim();

    try {
      const items = await getNearbyPlaces({
        location: { lat: mapCenter.latitude, lng: mapCenter.longitude },
        radius,
        type,
        query: kw,
      });
      setActiveCat(type);
      setResults(items || []);
    } catch (e) {
      console.warn('StopsOverlay getNearbyPlaces error', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [mapCenter, radius, activeCat]);

  const handleAdd = useCallback(async (item) => {
    try {
      const detail = await getPlaceDetails(item.place_id);
      if (detail) onAddStop(detail);
    } catch (e) {
      console.warn('StopsOverlay add stop error', e);
    }
  }, [onAddStop]);

  const renderItem = ({ item }) => {
    const title = item.name || 'Yer';
    const vicinity = item.address || item.vicinity || item.formatted_address || '';
    const rating = item.rating ? `★ ${Number(item.rating).toFixed(1)}` : '';
    const openNow = item.opening_hours?.open_now;

    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={2}>{vicinity}</Text>
          <View style={styles.metaRow}>
            {!!rating && <Text style={styles.badge}>{rating}</Text>}
            {openNow === true && <Text style={[styles.badge, styles.open]}>Açık</Text>}
            {openNow === false && <Text style={[styles.badge, styles.closed]}>Kapalı</Text>}
          </View>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => handleAdd(item)}>
          <MaterialIcons name="add" size={20} color="#fff" />
          <Text style={styles.addLabel}>Ekle</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? 1 : -1}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      handleIndicatorStyle={{ backgroundColor: '#ccc' }}
    >
      <BottomSheetScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Durak Ekle</Text>

        <View style={styles.chipsRow}>
          {DEFAULT_CATEGORIES.map(c => (
            <TouchableOpacity
              key={c.key}
              style={[styles.chip, activeCat === c.key && styles.chipActive]}
              onPress={() => handleSearchCategory(c.key)}
            >
              <MaterialIcons name={c.icon} size={16} color={activeCat === c.key ? '#fff' : '#333'} />
              <Text style={[styles.chipLabel, activeCat === c.key && { color: '#fff' }]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchRow}>
          <MaterialIcons name="search" size={20} color="#666" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Yer ara (ör. 'tuvalet', 'fırın', 'Starbucks')"
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={() => handleSearchCategory(query.trim() || activeCat)}
          />
          <TouchableOpacity onPress={() => handleSearchCategory(query.trim() || activeCat)}>
            <Text style={styles.searchBtn}>Ara</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="small" />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(it, idx) => it.place_id ?? String(idx)}
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={<Text style={styles.empty}>Sonuç bulunamadı.</Text>}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}
          />
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 8 },
  header: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1f3f5' },
  chipActive: { backgroundColor: '#0B72E7' },
  chipLabel: { fontWeight: '600', color: '#333' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f6f7f9', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input: { flex: 1, paddingVertical: 0 },
  searchBtn: { color: '#0B72E7', fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, elevation: 1 },
  title: { fontWeight: '700', fontSize: 15 },
  sub: { color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  badge: { backgroundColor: '#eef1f4', color: '#333', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 12 },
  open: { backgroundColor: '#E6F6EA', color: '#117A37' },
  closed: { backgroundColor: '#FDEBEE', color: '#B42318' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0B72E7', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  addLabel: { color: '#fff', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#666', marginTop: 16 },
});
