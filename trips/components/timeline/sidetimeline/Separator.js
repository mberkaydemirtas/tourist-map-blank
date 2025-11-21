// src/components/timeline/SideTimeline/Separator.js
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';

export default function Separator({ insertIndex, onInsert, highlight }) {
  return (
    <View style={styles.sepWrap}>
      <View style={[styles.sepLine, highlight && { backgroundColor: '#11182722' }]} />
      <Pressable
        onPress={() => onInsert?.(insertIndex)}
        style={[styles.sepAddBtn, highlight && styles.sepAddBtnHL]}
        hitSlop={6}
      >
        <Ionicons name="add" size={14} color={highlight ? '#fff' : '#111827'} />
        <Text style={[styles.sepAddTxt, highlight && { color: '#fff' }]}>
          {highlight ? 'Buraya ekle' : 'Durak ekle'}
        </Text>
      </Pressable>
      <View style={[styles.sepLine, highlight && { backgroundColor: '#11182722' }]} />
    </View>
  );
}
