// src/components/timeline/SideTimeline/AnchorBadge.js
import React from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';

export default function AnchorBadge({ kind }) {
  const map = {
    start:   { bg: '#10B981', icon: 'play' },
    lodging: { bg: '#7C3AED', icon: 'home' },
    end:     { bg: '#EF4444', icon: 'stop' },
  };
  const k = map[kind] || map.start;
  return (
    <View style={[styles.anchorBadge, { backgroundColor: k.bg }]}>
      <Ionicons name={k.icon} size={12} color="#fff" />
    </View>
  );
}
