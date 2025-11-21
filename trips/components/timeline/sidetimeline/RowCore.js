// src/components/timeline/SideTimeline/RowCore.js
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from './styles';
import { getAnchorKind, isAnchorItem, rowName, TITLE_MAX_LINES } from './utils';
import AnchorBadge from './AnchorBadge';

function AnchorRouteButton({ onPress }) {
  if (!onPress) return null;
  return (
    <View style={styles.rowTailAbs}>
      <Pressable
        onPress={onPress}
        style={[styles.kebabBtn, { backgroundColor: '#DCF1FF', borderColor: '#B6E0FF' }]}
        hitSlop={8}
        accessibilityLabel="Rota"
      >
        <Ionicons name="navigate-outline" size={16} color="#0C4A6E" />
      </Pressable>
    </View>
  );
}

export default function RowCore({
  item,
  index,
  selected,
  onPress,
  onReplace,
  onDeleteAsk,
  drag,
  isActive,
  onOpenMenu,
  onAnchorRoute,
}) {
  const order = (index ?? 0) + 1;
  const name = rowName(item, index);
  const isAnchor = isAnchorItem(item);
  const time = (!isAnchor && item?.start && item?.end) ? `${item.start} – ${item.end}` : null;
  const anchorKind = getAnchorKind(item);
  const category = isAnchor
    ? (anchorKind?.toUpperCase?.() || 'ANCHOR')
    : (item?.place?.category || item?.meta?.category || item?.type || '');
  const longTitle = String(name).length > 34;
  const displayTitle = name;

  return (
    <View style={[styles.row, selected && styles.rowSelected, isActive && styles.rowDragging]}>
      <View style={styles.selStripe} pointerEvents="none" />
      <Pressable
        onPress={onPress}
        onLongPress={isAnchor ? undefined : drag}
        delayLongPress={isAnchor ? undefined : 160}
        android_ripple={{ color: '#E5E7EB' }}
        style={styles.rowTap}
      >
        <View style={styles.rowLead}>
          {isAnchor
            ? <AnchorBadge kind={anchorKind} />
            : (
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{order}</Text>
              </View>
            )}
        </View>
        <View style={styles.textBlock}>
          <Text numberOfLines={TITLE_MAX_LINES} ellipsizeMode="tail" style={styles.title}>
            {displayTitle}
          </Text>
          {!longTitle && (
            <View style={styles.metaRow}>
              {time ? <Text numberOfLines={1} style={[styles.metaTime, { marginRight: 6 }]}>{time}</Text> : null}
              {category ? <Text numberOfLines={1} style={styles.metaChip}>{String(category).toUpperCase()}</Text> : null}
            </View>
          )}
        </View>
        {isAnchor
          ? <AnchorRouteButton onPress={onAnchorRoute} />
          : (
            <View style={styles.rowTailAbs}>
              <Pressable onPress={() => onOpenMenu?.(name, onReplace, onDeleteAsk)} style={styles.kebabBtn} hitSlop={8} accessibilityLabel="Seçenekler">
                <Ionicons name="ellipsis-vertical" size={16} color="#374151" />
              </Pressable>
            </View>
          )
        }
      </Pressable>
    </View>
  );
}
