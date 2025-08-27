import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export default function RouteFormPanel({
  styles,
  fromLabel,
  toLabel,
  onSwap,
  onPickFrom,
  onPickTo,
}) {
  return (
    <View style={styles.routeControls}>
      <TouchableOpacity onPress={onSwap} style={styles.reverseCornerButton}>
        <Text style={styles.reverseIcon}>⇄</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Nereden</Text>
      <TouchableOpacity style={styles.inputButton} onPress={onPickFrom}>
        <Text style={styles.inputText}>{fromLabel || 'Konum seçin'}</Text>
      </TouchableOpacity>

      <View style={{ height: 10 }} />

      <Text style={styles.label}>Nereye</Text>
      <TouchableOpacity style={styles.inputButton} onPress={onPickTo}>
        <Text style={styles.inputText}>{toLabel || 'Nereye?'}</Text>
      </TouchableOpacity>
    </View>
  );
}
