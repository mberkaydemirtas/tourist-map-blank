// src/trips/CreateTripOverlay.js
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons';

export default function CreateTripOverlay({ visible, onClose, onStartScratch, onStartTemplate, onStartAI, online = true }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Yeni Gezi</Text>
          <View style={styles.actions}>
            <BigAction icon="document-text-outline" label="Start from scratch" onPress={onStartScratch} subtitle="Boş bir planla başla" />
            <BigAction icon="albums-outline" label="Start with template" onPress={onStartTemplate} subtitle="Hazır şablondan kopyala" />
            <BigAction icon="bulb-outline" label="Start with AI" onPress={onStartAI} subtitle="Tercihlerine göre otomatik plan" disabled={!online} badge={!online ? 'Offline' : 'Yakında'} />
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
            <Text style={styles.closeText}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function BigAction({ icon, label, subtitle, onPress, disabled, badge }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.bigAction, disabled && styles.disabled]} activeOpacity={0.8}>
      <View style={styles.row}>
        <Ionicons name={icon} size={28} color="#fff" />
        <View style={styles.col}>
          <View style={styles.row}>
            <Text style={styles.bigLabel}>{label}</Text>
            {badge ? <Text style={styles.badge}>{badge}</Text> : null}
          </View>
          <Text style={styles.subLabel}>{subtitle}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#0D0F14', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 10, gap: 12, borderWidth: 1, borderColor: '#23262F' },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  actions: { gap: 10 },
  bigAction: { borderWidth: 1, borderColor: '#23262F', borderRadius: 12, padding: 14, backgroundColor: '#1A1C22' },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  col: { flex: 1 },
  bigLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
  subLabel: { color: '#A8A8B3', marginTop: 2 },
  badge: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: Platform.select({ ios: 2, android: 4 }), borderRadius: 999, backgroundColor: '#23262F', color: '#fff', fontSize: 12, overflow: 'hidden' },
  closeBtn: { marginTop: 4, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  closeText: { color: '#9CA3AF', fontWeight: '700' },
});
