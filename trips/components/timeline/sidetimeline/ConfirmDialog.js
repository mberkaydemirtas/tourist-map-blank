// src/components/timeline/SideTimeline/ConfirmDialog.js
import React, { useEffect, useRef } from 'react';
import { View, Text, Modal, Pressable, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = 'Sil',
  cancelText = 'Vazgeç',
  onConfirm,
  onCancel
}) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 160 : 120,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, a]);

  if (!visible) return null;

  const trans = { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], opacity: a };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <Animated.View style={[styles.dialogCard, trans]}>
          {!!title && <Text style={styles.dialogTitle}>{title}</Text>}
          {!!message && <Text style={styles.dialogMsg}>{message}</Text>}
          <View style={styles.dialogBtns}>
            <Pressable onPress={onCancel} style={[styles.dBtn, styles.dCancel]}>
              <Text style={styles.dCancelTxt}>{cancelText}</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={[styles.dBtn, styles.dDanger]}>
              <Ionicons name="trash-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.dDangerTxt}>{confirmText}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
