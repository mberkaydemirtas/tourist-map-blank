// src/components/timeline/SideTimeline/MiniSheet.js
import React, { useEffect, useRef } from 'react';
import { View, Text, Modal, Pressable, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';

export default function MiniSheet({ visible, title, onReplace, onDeleteAsk, onClose }) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, a]);

  if (!visible) return null;

  const trans = { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }], opacity: a };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop} pointerEvents="box-none">
        <Pressable style={styles.sheetTapCatcher} onPress={onClose} />
        <Animated.View style={[styles.sheetCard, trans]}>
          {!!title && <Text style={styles.sheetTitle} numberOfLines={2}>{title}</Text>}
          <Pressable style={styles.sheetItem} onPress={() => { onClose?.(); onReplace?.(); }}>
            <Ionicons name="swap-horizontal-outline" size={18} color="#111827" style={{ marginRight: 10 }} />
            <Text style={styles.sheetText}>Değiştir</Text>
          </Pressable>
          <Pressable style={[styles.sheetItem, { backgroundColor: '#FEF2F2' }]} onPress={() => { onClose?.(); onDeleteAsk?.(); }}>
            <Ionicons name="trash-outline" size={18} color="#B91C1C" style={{ marginRight: 10 }} />
            <Text style={[styles.sheetText, { color: '#B91C1C', fontWeight: '800' }]}>Sil</Text>
          </Pressable>
          <Pressable style={styles.sheetItem} onPress={onClose}>
            <Ionicons name="close" size={18} color="#111827" style={{ marginRight: 10 }} />
            <Text style={styles.sheetText}>Kapat</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
