import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';

/**
 * Props:
 *  - visible: boolean
 *  - onClose: ()=>void
 *  - steps: Array<Step>
 *  - currentIndex?: number
 *  - onSpeakStep?: (i:number)=>void
 *  - onJumpToIndex?: (i:number)=>void
 *  - onSpeakAll?: (startIndex?:number)=>void
 */
export default function StepInstructionsModal({
  visible,
  onClose,
  steps = [],
  currentIndex = 0,
  onSpeakStep,
  onJumpToIndex,
  onSpeakAll,
}) {
  const listRef = useRef(null);

  // Açıldığında aktif adıma kaydır
  useEffect(() => {
    if (!visible) return;
    // kısa gecikme: modal mount olsun
    const t = setTimeout(() => {
      if (Number.isFinite(currentIndex) && currentIndex >= 0 && currentIndex < steps.length) {
        try {
          listRef.current?.scrollToIndex?.({ index: currentIndex, animated: true, viewPosition: 0.3 });
        } catch {}
      }
    }, 150);
    return () => clearTimeout(t);
  }, [visible, currentIndex, steps.length]);

  const data = useMemo(() => Array.isArray(steps) ? steps : [], [steps]);

  const getTitle = (s) =>
    s?.maneuver?.instruction ||
    s?.instruction ||
    'Devam edin';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>🧭 Adım Adım Yol Tarifi</Text>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>Kapat</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => onSpeakAll?.(currentIndex)}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>Tümünü sırayla oku</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(_, index) => index.toString()}
            initialNumToRender={20}
            renderItem={({ item, index }) => {
              const active = index === currentIndex;
              const dist = Number.isFinite(item?.distance) ? Math.round(item.distance) : null;

              return (
                <View style={[styles.stepRow, active && styles.stepRowActive]}>
                  <View style={styles.stepMain}>
                    <Text style={[styles.stepIndex, active && styles.stepIndexActive]}>
                      {index + 1}.
                    </Text>
                    <Text style={[styles.stepText, active && styles.stepTextActive]} numberOfLines={3}>
                      {getTitle(item)}{dist != null ? ` (${dist} m)` : ''}
                    </Text>
                  </View>

                  <View style={styles.stepActions}>
                    <TouchableOpacity
                      onPress={() => onSpeakStep?.(index)}
                      style={styles.iconBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.iconBtnText}>🔊</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => onJumpToIndex?.(index)}
                      style={[styles.iconBtn, { marginLeft: 4 }]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.iconBtnText}>➡️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={{ paddingBottom: 16 }}
            getItemLayout={(_, i) => ({ length: 56, offset: 56 * i, index: i })}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: '80%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  headerBtnText: { fontWeight: '700', color: '#111' },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  primaryBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },

  stepRow: {
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  stepRowActive: {
    backgroundColor: '#F0F7FF',
  },
  stepMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  stepIndex: { width: 22, textAlign: 'right', marginRight: 8, fontWeight: '700', color: '#666' },
  stepIndexActive: { color: '#1565C0' },
  stepText: { flex: 1, fontSize: 14.5, color: '#222' },
  stepTextActive: { color: '#0D47A1', fontWeight: '700' },

  stepActions: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4 },
  iconBtn: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  iconBtnText: { fontSize: 16 },
});
