// src/components/timeline/SideTimeline/LegConnector.js
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';

export default function LegConnector({ label, onPress }) {
  if (!label) return null;
  return (
    <View style={styles.legWrap}>
      <View style={styles.legLine} />
      <Pressable onPress={onPress} style={styles.legBtn} hitSlop={6} accessibilityLabel={`${label} arasını göster`}>
        <Ionicons name="git-commit-outline" size={14} color="#1D4ED8" />
        <Text style={styles.legTxt}>{label}</Text>
      </Pressable>
      <View style={styles.legLine} />
    </View>
  );
}
