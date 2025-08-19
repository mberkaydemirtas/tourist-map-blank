// src/trips/TripsListScreen.js
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { listTrips, deleteTrip, duplicateTrip } from './services/tripsService';
import { formatDate } from './shared/types';
import CreateTripOverlay from './CreateTripOverlay';

const BORDER = '#23262F';

export default function TripsListScreen() {
  const nav = useNavigation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await listTrips()); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startScratch = () => { setOverlay(false); nav.navigate('CreateTripWizard'); };

  const onDelete = (id, title) => {
    Alert.alert('Geziyi Sil', `"${title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => { await deleteTrip(id); load(); } },
    ]);
  };
  const onDuplicate = async (id) => { await duplicateTrip(id); load(); };

  const header = useMemo(() => (
    <View style={styles.tableHeader}>
      <Text style={[styles.cell, styles.flex2, styles.headerText]}>Adı</Text>
      <Text style={[styles.cell, styles.center, styles.headerText]}>Durak</Text>
      <Text style={[styles.cell, styles.flex1, styles.headerText]}>Oluşturulma</Text>
      <Text style={[styles.cell, styles.flex1, styles.headerText]}>Güncellendi</Text>
      <Text style={[styles.cell, styles.actionsHeader]} />
    </View>
  ), []);

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => nav.navigate('TripEditor', { id: item.id })}>
      <Text style={[styles.cell, styles.flex2]} numberOfLines={1}>{item.title}</Text>
      <Text style={[styles.cell, styles.center]}>{item.stops?.length ?? 0}</Text>
      <Text style={[styles.cell, styles.flex1]}>{formatDate(item.createdAt)}</Text>
      <Text style={[styles.cell, styles.flex1]}>{formatDate(item.updatedAt)}</Text>
      <View style={[styles.cell, styles.actions]}>
        <TouchableOpacity onPress={() => onDuplicate(item.id)} style={styles.iconBtn}><Ionicons name="copy-outline" size={20} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={() => nav.navigate('TripEditor', { id: item.id })} style={styles.iconBtn}><Ionicons name="pencil-outline" size={20} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(item.id, item.title)} style={styles.iconBtn}><Ionicons name="trash-outline" size={20} color="#ef4444" /></TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Gezilerim</Text>
        <TouchableOpacity onPress={() => setOverlay(true)} style={styles.newBtn} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>Yeni Gezi</Text>
        </TouchableOpacity>
      </View>

      {header}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={22} color="#A8A8B3" />
            <Text style={styles.emptyText}>Henüz gezi yok. “Yeni Gezi” ile başlayın.</Text>
          </View>
        ) : null}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      <CreateTripOverlay
        visible={overlay}
        onClose={() => setOverlay(false)}
        onStartScratch={startScratch}
        onStartTemplate={() => {}}
        onStartAI={() => {}}
        online={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014' },
  topBar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#fff' },
  newBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, gap: 6 },
  newBtnText: { color: '#fff', fontWeight: '600' },

  tableHeader: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#0D0F14' },
  headerText: { fontWeight: '700', color: '#FFFFFF' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: BORDER },
  cell: { paddingHorizontal: 6, fontSize: 14, color: '#FFFFFF' },
  flex2: { flex: 2 }, flex1: { flex: 1 }, center: { textAlign: 'center' },

  actionsHeader: { width: 96, textAlign: 'right' },
  actions: { width: 96, flexDirection: 'row', justifyContent: 'flex-end' },
  iconBtn: { padding: 6, marginLeft: 4 },

  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { color: '#A8A8B3' },
});
