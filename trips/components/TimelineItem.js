// trips/components/TimelineItem.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const FG = '#E7ECF3';
const MUTED = '#A3ACB8';
const CARD = '#0F131A';
const BORDER = '#1E2430';

export default function TimelineItem({ activity }) {
  const { type, start, end, durationMin, label, place, meta } = activity || {};
  const title = place?.name || label || (type === 'meal' ? 'Meal' : type);
  const timeText = (start && end) ? `${start} - ${end}` : (durationMin ? `~${durationMin} dk` : '');
  const isSuggestion = activity?.label === 'suggestion' || meta?.suggestion === true || activity?.suggestion === true;

  const icon = type === 'visit' ? 'location' :
               type === 'meal' ? 'restaurant' :
               type === 'transfer' ? 'navigate' :
               'time';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name={icon} size={16} color="#99B4FF" style={{ marginRight: 8 }} />
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {isSuggestion && (
          <View style={styles.suggestion}>
            <Text style={styles.suggestionText}>suggestion</Text>
          </View>
        )}
      </View>
      <View style={styles.metaRow}>
        {timeText ? <Text style={styles.meta}>{timeText}</Text> : null}
        {place?.rating ? <Text style={styles.meta}> • ⭐ {place.rating.toFixed(1)}</Text> : null}
        {place?.address ? <Text style={styles.meta} numberOfLines={1}> • {place.address}</Text> : null}
      </View>
      {meta?.open ? <Text style={[styles.meta, { marginTop: 2 }]}>🕘 {meta.open}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { color: FG, fontSize: 14, fontWeight: '600', flex: 1 },
  suggestion: {
    marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, backgroundColor: '#1C2434', borderWidth: 1, borderColor: '#2D3A55'
  },
  suggestionText: { color: '#9CB6FF', fontSize: 11, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  meta: { color: MUTED, fontSize: 12 },
});
