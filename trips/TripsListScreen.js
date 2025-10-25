// trips/TripsListScreen.js
import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  RefreshControl, Platform, Dimensions, Modal, Pressable, DeviceEventEmitter, TextInput
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';

// === Yeni servisler (offline-first + sync) ===
import { listTripsLocal, createTripLocal, markDeleteLocal, getTripLocal } from '../app/lib/tripsLocal';
import { syncTrips } from '../app/services/tripsSync';
import { getDeviceId } from '../app/services/device';
import { SERVER_ENABLED } from '../app/lib/api';

// (Varsa senin tarih helper'ın kalsın)
import { formatDate } from './shared/types';

const BORDER = '#23262F';

// 🔔 Wizard adımlarından canlı güncelleme için kullanılacak event adı
const EVT_TRIP_META_UPDATED = 'TRIP_META_UPDATED';

export default function TripsListScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const firstLoadedRef = useRef(false);
  const [menuFor, setMenuFor] = useState(null); // { id, title, status } | null
  const [menuAnchor, setMenuAnchor] = useState(null); // { x, y, width, height }

  // NEW: “Yeni Gezi” seçim modalı ve “Ad Gir” modalı
  const [newTripSheetOpen, setNewTripSheetOpen] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [scratchName, setScratchName] = useState('');

  const onSelectPlaces = (id) => {
    nav.navigate('TripPlacesScreen', { id });
  };

  // id/_id normalize — her kayıtta ikisi de mevcut olsun
  function ensureIds(t, i = 0) {
    const _id = t?._id ?? t?.id ?? `migr-${(t?.createdAt || t?.updatedAt || Date.now())}-${i}`;
    const id  = t?.id  ?? _id;
    return { ...t, _id, id };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) yerelden yükle
      const rows = await listTripsLocal();
      setItems(rows.filter(x => !x?.deleted).map(ensureIds));

      // 2) server açıksa arkada sessiz senkron (UI'ı bloklama)
      if (SERVER_ENABLED) {
        (async () => {
          try {
            const deviceId = await getDeviceId();
            await syncTrips({ deviceId });
            const rows2 = await listTripsLocal();
            setItems(rows2.filter(x => !x?.deleted).map(ensureIds));
          } catch {}
        })();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ Her odaklanmada yenile
  useFocusEffect(
    useCallback(() => {
      firstLoadedRef.current = true;
      load();
    }, [load])
  );

  // ✅ Wizard’dan anlık patch almak için event dinleyici
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_TRIP_META_UPDATED, ({ tripId, patch }) => {
      if (!tripId || !patch) return;
      setItems((prev) =>
        prev.map((t, i) => {
          const match = t._id === tripId || t.id === tripId;
          return match ? ensureIds({ ...t, ...patch, updatedAt: new Date().toISOString() }, i) : t;
        })
      );
    });
    return () => sub.remove();
  }, []);

  // ✅ route param ile gelen patch’i uygula
  useEffect(() => {
    const patchParam = route?.params?.patchTrip;
    if (patchParam?.id && patchParam?.data) {
      setItems((prev) =>
        prev.map((t, i) => {
          const match = t._id === patchParam.id || t.id === patchParam.id;
          return match ? ensureIds({ ...t, ...patchParam.data }, i) : t;
        })
      );
      nav.setParams({ ...route.params, patchTrip: undefined });
    }
  }, [route?.params?.patchTrip, nav, route?.params]);

  function EllipsisButton({ onMeasureAndOpen }) {
    const ref = useRef(null);
    const handlePress = () => {
      ref.current?.measureInWindow?.((x, y, width, height) => {
        onMeasureAndOpen?.({ x, y, width, height });
      });
    };
    return (
      <View ref={ref} collapsable={false}>
        <TouchableOpacity onPress={handlePress} style={styles.iconBtn} accessibilityLabel="Daha fazla">
          <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  // === ESKİ: tek buton → Wizard akışı
  // const startNewTrip = useCallback(() => {
  //   nav.navigate('CreateTripWizard');
  // }, [nav]);

  // === YENİ: “Yeni Gezi” → seçenek sayfası
  const openNewTripSheet = useCallback(() => setNewTripSheetOpen(true), []);
  const closeNewTripSheet = useCallback(() => setNewTripSheetOpen(false), []);

  // Start From Scratch akışı
  const createScratchAndOpen = useCallback(async () => {
    const title = (scratchName || '').trim();
    if (title.length < 2) {
      Alert.alert('Gezi adı', 'Lütfen en az 2 karakterlik bir isim girin.');
      return;
    }
    try {
      // Sadece temel alanlarla taslak trip
      const t = await createTripLocal({
        title,
        status: 'active',              // boş plan için direkt aktif diyebiliriz
        wizardStep: null,              // wizard yok
        cities: [],
        dateRange: { start: null, end: null },
        places: [],
        dailyPlan: [],
      });

      // TripPlans'e SCRATCH modunda git
      nav.navigate('TripPlans', { tripId: t._id ?? t.id, mode: 'scratch' });
      setNameModalOpen(false);
      setNewTripSheetOpen(false);
      setScratchName('');
    } catch (e) {
      Alert.alert('Yeni gezi', 'Gezi oluşturulurken bir hata oluştu.');
    }
  }, [scratchName, nav]);

  const onDelete = (id, title) => {
    Alert.alert('Geziyi Sil', `"${title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await markDeleteLocal(id);
          if (SERVER_ENABLED) {
            try {
              const deviceId = await getDeviceId();
              await syncTrips({ deviceId });
            } catch {}
          }
          await load();
        }
      },
    ]);
  };

  const onDuplicate = async (id) => {
    const src = await getTripLocal(id);
    if (!src) return;
    const copy = {
      ...src,
      _id: undefined,
      title: (src.title || 'Trip') + ' (Copy)',
      updatedAt: new Date().toISOString(),
      version: 0,
      __dirty: true,
    };
    await createTripLocal(copy);
    if (SERVER_ENABLED) {
      try {
        const deviceId = await getDeviceId();
        await syncTrips({ deviceId });
      } catch {}
    }
    await load();
  };

  const Header = useMemo(() => (
    <View style={styles.tableHeader}>
      <Text style={[styles.hCell, styles.flex2]}>Gezi</Text>
      <Text style={[styles.hCell, styles.flex3, styles.right]}>Tarih</Text>
      <Text style={[styles.hCell, styles.actionsHeader]} />
    </View>
  ), []);

  // 🔎 “Tamamlandı” durumunu belirle
  const isCompletedTrip = (item) => {
    if (!item) return false;
    if (item.status === 'completed') return true;
    if (item.status === 'draft') return false;
    const endISO = item?.dateRange?.end;
    if (!endISO) return false;
    const todayISO = new Date().toISOString().slice(0, 10);
    return endISO < todayISO; // bitiş geçmişse completed say
  };

  const renderItem = ({ item }) => {
    const completed = isCompletedTrip(item);
    const tripKey = item._id ?? item.id;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.8}
        onPress={() => {
          if (item.status === 'draft') {
            nav.navigate('CreateTripWizard', { resumeId: tripKey });
          } else {
            // completed / active -> haritalı ekran
            nav.navigate('TripPlans', { tripId: tripKey });
          }
        }}
        onLongPress={() => nav.navigate('TripEditor', { id: tripKey })}
      >
        <View style={[styles.cell, styles.flex2]}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <Text style={styles.title} numberOfLines={2}>{item.title || '(untitled)'}</Text>
            {item.status === 'draft' ? (
              <Text style={styles.draftBadge}>Taslak</Text>
            ) : completed ? (
              <Text style={styles.completedBadge}>Tamamlandı</Text>
            ) : null}
          </View>
          {/* Şehir listesi */}
          <Text style={styles.subTitle} numberOfLines={1}>
            {(Array.isArray(item?.cities) && item.cities.length > 0) ? item.cities.join(' • ') : 'Şehir seçilmedi'}
          </Text>
        </View>

        {/* Tarih aralığı */}
        <Text style={[styles.cell, styles.flex3, styles.right]} numberOfLines={1} ellipsizeMode="head">
          {(item?.dateRange?.start || '—')} → {(item?.dateRange?.end || '—')}
        </Text>

        <View style={[styles.cell, styles.actions]}>
          <EllipsisButton
            onMeasureAndOpen={(anchorRect) => {
              setMenuAnchor(anchorRect);
              setMenuFor({ id: tripKey, title: item.title, status: item.status });
            }}
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Gezilerim</Text>
        <TouchableOpacity onPress={openNewTripSheet} style={styles.newBtn} activeOpacity={0.9}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>Yeni Gezi</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it, index) =>
          String(it?._id ?? it?.id ?? `t-${index}-${it?.title ?? ''}-${it?.updatedAt ?? ''}`)
        }
        renderItem={renderItem}
        ListHeaderComponent={Header}
        stickyHeaderIndices={[0]}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={24} color="#A8A8B3" />
            <Text style={styles.emptyText}>Henüz gezi yok. “Yeni Gezi” ile başlayın.</Text>
          </View>
        ) : null}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      {/* Satır menüsü */}
      <RowActionMenu
        visible={!!menuFor}
        title={menuFor?.title}
        anchor={menuAnchor}
        onClose={() => { setMenuFor(null); setMenuAnchor(null); }}
        onCopy={async () => { if (menuFor) await onDuplicate(menuFor.id); setMenuFor(null); }}
        onEdit={() => {
          if (!menuFor) return;
          const row = items.find(t => (t._id === menuFor.id || t.id === menuFor.id));
          if (row?.status === 'draft') nav.navigate('CreateTripWizard', { resumeId: menuFor.id });
          else nav.navigate('TripPlans', { tripId: menuFor.id });
          setMenuFor(null);
        }}
        onDelete={() => { if (menuFor) onDelete(menuFor.id, menuFor.title); setMenuFor(null); }}
      />

      {/* “Yeni Gezi” seçenek sayfası */}
      <Modal visible={newTripSheetOpen} transparent animationType="fade" onRequestClose={closeNewTripSheet}>
        <Pressable style={styles.menuBackdrop} onPress={closeNewTripSheet} />
        <View style={[styles.sheetCard]}>
          <Text style={styles.sheetTitle}>Yeni gezi başlat</Text>

          <TouchableOpacity
            style={styles.sheetItem}
            onPress={() => {
              // Start From Scratch → ad gir modalı
              setNameModalOpen(true);
            }}
          >
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetItemTitle}>Start From Scratch</Text>
              <Text style={styles.sheetItemSub}>Boş planla başla; durakları ve günleri kendin ekle.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sheetItem}
            onPress={() => {
              // Guided Plan = önceki “start from scratch” otomasyon akışı
              setNewTripSheetOpen(false);
              nav.navigate('CreateTripWizard'); // otomasyon
            }}
          >
            <Ionicons name="sparkles-outline" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetItemTitle}>Guided Plan</Text>
              <Text style={styles.sheetItemSub}>Soruları cevapla, rotan otomatik oluşturulsun.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sheetItem}
            onPress={() => Alert.alert('Templates', 'Template seçimi yakında eklenecek.')}
          >
            <Ionicons name="albums-outline" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetItemTitle}>Start With Template</Text>
              <Text style={styles.sheetItemSub}>Hazır şablondan kopyala ve düzenle.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sheetItem}
            onPress={() => Alert.alert('AI Planner', 'AI planlama yakında eklenecek.')}
          >
            <Ionicons name="bulb-outline" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetItemTitle}>Start With AI</Text>
              <Text style={styles.sheetItemSub}>Yapay zekâ ile akıllı önerilerle başla.</Text>
            </View>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Ad gir modalı (Start From Scratch) */}
      <Modal visible={nameModalOpen} transparent animationType="fade" onRequestClose={() => setNameModalOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setNameModalOpen(false)} />
        <View style={styles.nameCard}>
          <Text style={styles.sheetTitle}>Gezi adı</Text>
          <TextInput
            placeholder="Örn: Ankara Sonbahar"
            placeholderTextColor="#6B7280"
            value={scratchName}
            onChangeText={setScratchName}
            style={styles.nameInput}
            autoFocus
            maxLength={80}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setNameModalOpen(false)}>
              <Text style={styles.secondaryText}>Vazgeç</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={createScratchAndOpen}>
              <Text style={styles.primaryText}>Oluştur</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014' },
  topBar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },

  tableHeader: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14',
  },
  hCell: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  right: { textAlign: 'right' },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12,
    borderBottomWidth: 1, borderColor: BORDER, gap: 8,
  },

  cell: { paddingHorizontal: 6 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  subTitle: { color: '#A8A8B3', fontSize: 12, marginTop: 2 },

  draftBadge: {
    color: '#f59e0b',
    borderColor: '#f59e0b',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontSize: 11,
    fontWeight: '800',
  },
  completedBadge: {
    color: '#34d399',
    borderColor: '#34d399',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontSize: 11,
    fontWeight: '800',
  },

  flex3: { flex: 3 },
  flex2: { flex: 2 },
  center: { textAlign: 'center' },

  actionsHeader: { width: 60, textAlign: 'right' },
  actions: { width: 60, flexDirection: 'row', justifyContent: 'flex-end' },
  iconBtn: { padding: 6, marginLeft: 6 },

  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { color: '#A8A8B3' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10 },
  newBtnText: { color: '#fff', fontWeight: '700' },

  /* Action menu */
  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },

  sheetCard: {
    position: 'absolute', left: 16, right: 16, bottom: 24,
    backgroundColor: '#0D0F14',
    borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12,
  },
  sheetTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 6 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: BORDER, marginTop: 8 },
  sheetItemTitle: { color: '#fff', fontWeight: '700' },
  sheetItemSub: { color: '#9AA0A6', fontSize: 12, marginTop: 2 },

  nameCard: {
    position: 'absolute', left: 16, right: 16, bottom: 24,
    backgroundColor: '#0D0F14',
    borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12,
  },
  nameInput: {
    marginTop: 8,
    borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, color: '#fff',
  },

  /* Reuse buttons */
  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderColor: BORDER, borderWidth: 1, backgroundColor: '#0D0F14' },
  secondaryText: { color: '#fff', fontWeight: '700' },
  primaryBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: '#2563EB' },
  primaryText: { color: '#fff', fontWeight: '700' },
});

/* --- satır sonunda: menü komponenti --- */
function RowActionMenu({ visible, title, anchor, onClose, onCopy, onEdit, onDelete }) {
  if (!visible) return null;
  const win = Dimensions.get('window');
  const MENU_W = 200; // tahmini genislik
  const MENU_H_SAFE = 180; // clamp için alt boşluk tahmini
  let top = 20, left = win.width - MENU_W - 12;
  if (anchor) {
    const margin = 6;
    const desiredTop = anchor.y - margin - 8 - MENU_H_SAFE * 0.1;
    const desiredLeft = anchor.x + anchor.width - MENU_W;
    top = Math.max(12, Math.min(desiredTop, win.height - MENU_H_SAFE));
    left = Math.max(12, Math.min(desiredLeft, win.width - MENU_W - 12));
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ ...styles.menuBackdrop }} onPress={onClose} />
      <View style={{ position: 'absolute', top, left, width: MENU_W, backgroundColor: '#0D0F14', borderRadius: 12, borderWidth: 1, borderColor: BORDER }}>
        {!!title && (
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: '#9AA0A6', fontSize: 12 }} numberOfLines={1}>{title}</Text>
          </View>
        )}
        <TouchableOpacity onPress={onCopy} style={{ paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="copy-outline" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>Kopyala</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onEdit} style={{ paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="pencil-outline" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>Düzenle</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={{ paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
          <Text style={{ color: '#ef4444', fontWeight: '800' }}>Sil</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
