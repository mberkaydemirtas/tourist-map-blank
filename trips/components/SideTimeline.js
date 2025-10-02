import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import TimelineItem from './TimelineItem';

const FG = '#111827';
const FG_MUTED = '#6B7280';
const CARD_BG = '#FFFFFF';

export default function SideTimeline({
  isOpen,
  plan,
  dayIndex,
  setDayIndex,
  onToggle,              // dış overlay toggle varsa gerekmeyebilir
  showToggle = false,    // default: kapalı
  showDayPicker = false, // default: kapalı (gün seçimi üst barda)
}) {
  const days = plan?.days || [];
  const day = days[dayIndex] || null;

  const dayTabs = useMemo(
    () => days.map((d, i) => ({ key: `${d.date || 'day'}-${i}`, label: d.date || `Gün ${i + 1}` })),
    [days]
  );

  return (
    <View style={styles.wrap}>
      {/* Üst başlık — yan buton YOK */}
      <View style={styles.header}>
        {showToggle && typeof onToggle === 'function' ? (
          <Pressable onPress={onToggle} style={styles.toggleBtn} hitSlop={8}>
            <Ionicons name={isOpen ? 'chevron-back' : 'chevron-forward'} size={18} color={FG} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}

        <Text style={styles.title}>Duraklar</Text>

        {/* sağ boşluk — eski buton kaldırıldı */}
        <View style={{ width: 28 }} />
      </View>

      {!isOpen ? (
        <View style={styles.collapsed}>
          <Text style={styles.collapsedText}>Timeline</Text>
        </View>
      ) : (
        <>
          {showDayPicker && (
            <View style={styles.tabs}>
              <FlatList
                horizontal
                data={dayTabs}
                keyExtractor={(it) => it.key}
                renderItem={({ item, index }) => {
                  const active = index === dayIndex;
                  return (
                    <Pressable
                      onPress={() => setDayIndex?.(index)}
                      style={[styles.tab, active && styles.tabActive]}
                    >
                      <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
                    </Pressable>
                  );
                }}
                contentContainerStyle={{ paddingHorizontal: 8 }}
                showsHorizontalScrollIndicator={false}
              />
            </View>
          )}

          <FlatList
            data={day?.activities || []}
            keyExtractor={(a, i) =>
              a.id
                ? String(a.id)
                : `${a.type || 'act'}-${a.place?.id || a.place?.name || 'x'}-${a.start || ''}-${i}`
            }
            renderItem={({ item }) => <TimelineItem activity={item} />}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            contentContainerStyle={{ padding: 12, paddingBottom: 42 }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: CARD_BG },
  header: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
    backgroundColor: CARD_BG,
  },
  toggleBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  title: { color: FG, fontSize: 14, fontWeight: '800', flex: 1 },
  tabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 6,
    backgroundColor: CARD_BG,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    marginRight: 6,
  },
  tabActive: { backgroundColor: '#111827', borderColor: '#111827' },
  tabText: { color: '#111827', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#FFFFFF' },
  collapsed: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  collapsedText: { color: FG_MUTED, fontSize: 12, transform: [{ rotate: '-90deg' }] },
});
