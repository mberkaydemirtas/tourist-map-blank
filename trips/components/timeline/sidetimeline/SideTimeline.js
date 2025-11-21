// src/components/timeline/SideTimeline/SideTimeline.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { extractCoord, getAnchorKind, isAnchorItem, rowName } from './utils';
import { styles } from './styles';
import RowCore from './RowCore';
import Separator from './Separator';
import LegConnector from './LegConnector';
import MiniSheet from './MiniSheet';
import ConfirmDialog from './ConfirmDialog';

let DraggableFlatList;
try {
  DraggableFlatList = require('react-native-draggable-flatlist').default;
} catch {}

export default function SideTimeline({
  isOpen = true,
  plan,
  dayIndex = 0,
  setDayIndex,
  selectedActivityId,

  onFocus,
  onSelect,

  onInsertAt,
  onEditAt,
  onDeleteAt,
  onReorder,
  insertMode = false,
  onPickInsertIndex,

  // 🔁 SADECE bu “eski tarz” leg callback'leri kullanacağız:
  onPickLeg,
  onPickStartLeg,
  onPickEndLeg,
  onPickLodgingLeg,

  // Eski API geriye dönük uyum için duruyor ama kullanılmıyor
  // onPickLegPair,

  startAnchor,
  endAnchor,
  lodgingAnchor,
}) {
  const days = plan?.days || [];
  const day = days[dayIndex] || null;

  function coordSig(a) {
    const c = extractCoord(a);
    return c ? `${Number(c.lat).toFixed(5)},${Number(c.lon).toFixed(5)}` : '';
  }

  function computeUniqueKeys(list) {
    const seen = new Map();
    return (list || []).map((a, i) => {
      const base =
        a?._key ||
        a?.id ||
        a?.place?.place_id ||
        coordSig(a) ||
        `idx:${i}`;
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      const uniq = count === 1 ? base : `${base}#${count}`;
      return { ...a, _key: uniq };
    });
  }

  const acts = computeUniqueKeys(day?.activities || []);

  function coordsEqual(a, b) {
    const alon = a?.lon ?? a?.lng;
    const blon = b?.lon ?? b?.lng;
    return (a?.lat === b?.lat) && (alon === blon);
  }

  const startIsLodge =
    startAnchor?.location &&
    lodgingAnchor?.location &&
    coordsEqual(startAnchor.location, lodgingAnchor.location);

  const endIsLodge =
    endAnchor?.location &&
    lodgingAnchor?.location &&
    coordsEqual(endAnchor.location, lodgingAnchor.location);

  const makeAnchorItem = (k, a) =>
    a
      ? {
          id: `anchor:${k}`,
          type: 'anchor',
          anchorKind: k,
          label:
            k === 'lodging'
              ? 'Konaklama'
              : k === 'start'
              ? startIsLodge
                ? 'Konaklama'
                : 'Başlangıç'
              : endIsLodge
              ? 'Konaklama'
              : 'Bitiş',
          place: {
            name: k === 'lodging' ? 'Konaklama' : a.label || '',
            location: a.location,
          },
          _key: `anchor:${k}`,
        }
      : null;

  function lodgingShouldAdd(start, end, lodging) {
    if (!lodging?.location) return false;
    return (
      !coordsEqual(lodging.location, start?.location) &&
      !coordsEqual(lodging.location, end?.location)
    );
  }

  const lodgingAdd = lodgingShouldAdd(startAnchor, endAnchor, lodgingAnchor)
    ? makeAnchorItem('lodging', lodgingAnchor)
    : null;

  const actsContainAnchors = acts.some((a) => isAnchorItem(a));
  const listData = actsContainAnchors
    ? acts
    : [
        makeAnchorItem('start', startAnchor),
        ...acts,
        lodgingAdd,
        makeAnchorItem('end', endAnchor),
      ].filter(Boolean);

  if (!isOpen) return <View style={styles.closedStrip} />;

  const startAnchorExists =
    !!(
      listData.length &&
      isAnchorItem(listData[0]) &&
      getAnchorKind(listData[0]) === 'start'
    );
  const actOffset = startAnchorExists ? 1 : 0;
  const actCount = acts.length;

  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetCallbacks = useRef({ onReplace: null, onDeleteAsk: null });
  const [sheetTitle, setSheetTitle] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const confirmCb = useRef({ onConfirm: null });

  useEffect(() => {
    setSheetVisible(false);
    setConfirmVisible(false);
  }, [dayIndex]);

  const openMenu = (name, onReplace, onDeleteAsk) => {
    sheetCallbacks.current = { onReplace, onDeleteAsk };
    setSheetTitle(name || 'Durak');
    setSheetVisible(true);
  };
  const closeMenu = () => setSheetVisible(false);

  const askDelete = (name, index) => {
    setConfirmVisible(true);
    confirmCb.current.onConfirm = () => {
      setConfirmVisible(false);
      onDeleteAt?.(index);
    };
  };

  /**
   * 🔁 Burada artık sadece eski mantık var:
   * - İki normal aktivite arasındaysa → onPickLeg(fromIndex)
   * - Start ↔ activity → onPickStartLeg / onPickEndLeg
   * - Lodging ↔ activity → onPickLodgingLeg('before'|'after', index)
   */
  function callPair(fromListIdx, toListIdx) {
    const fromItem = listData[fromListIdx];
    const toItem = listData[toListIdx];

    const fromIsAnchor = isAnchorItem(fromItem);
    const toIsAnchor = isAnchorItem(toItem);

    // List indeks → gerçek activity indeks
    let from = fromIsAnchor ? -1 : fromListIdx - actOffset;
    let to = toIsAnchor ? actCount : toListIdx - actOffset;
    if (!Number.isFinite(from)) from = -1;
    if (!Number.isFinite(to)) to = actCount;

    // 1) İki normal activite arası → sadece ardışık ise leg
    if (!fromIsAnchor && !toIsAnchor) {
      if (to === from + 1) onPickLeg?.(from);
      return;
    }

    // 2) Anchor → Activity
    if (fromIsAnchor && !toIsAnchor) {
      const k = getAnchorKind(fromItem);
      if (k === 'start') return onPickStartLeg?.(to);
      if (k === 'lodging') return onPickLodgingLeg?.('after', to);
      if (k === 'end') return onPickEndLeg?.(to - 1);
      return;
    }

    // 3) Activity → Anchor
    if (!fromIsAnchor && toIsAnchor) {
      const k = getAnchorKind(toItem);
      if (k === 'end') return onPickEndLeg?.(from);
      if (k === 'lodging') return onPickLodgingLeg?.('before', from);
      if (k === 'start') return onPickStartLeg?.(from + 1);
    }

    // Anchor ↔ Anchor için ekstra bir şey yapmıyoruz (rota yok)
  }

  const renderConnectorBetween = (leftIdx) => {
    if (leftIdx < 0 || leftIdx >= listData.length - 1) return null;
    const a = listData[leftIdx];
    const b = listData[leftIdx + 1];

    const anchorShort = (k) =>
      k === 'start' ? '0' : k === 'end' ? 'B' : 'K'; // lodging=K

    const ordinalAt = (idx) => {
      let c = 0;
      for (let i = 0; i <= idx; i++) if (!isAnchorItem(listData[i])) c++;
      return c;
    };

    const labelFor = (item, idx) => {
      if (isAnchorItem(item)) return anchorShort(getAnchorKind(item));
      return String(ordinalAt(idx));
    };

    const leftLabel = labelFor(a, leftIdx);
    const rightLabel = labelFor(b, leftIdx + 1);
    const label = `${leftLabel} → ${rightLabel}`;

    return (
      <LegConnector
        key={`leg-${leftIdx}`}
        label={label}
        onPress={() => callPair(leftIdx, leftIdx + 1)}
      />
    );
  };

  const renderItem = ({ item, index, drag, isActive, getIndex }) => {
    const listIdx = Number.isFinite(index)
      ? index
      : typeof getIndex === 'function'
      ? getIndex() ?? 0
      : 0;

    const isAnchor = isAnchorItem(item);
    const selected =
      !isAnchor && selectedActivityId && item?.id === selectedActivityId;

    const onInsert = insertMode ? onPickInsertIndex : onInsertAt;

    const onPress = () => {
      const coord = extractCoord(item);
      const kind = isAnchor ? getAnchorKind(item) : null;
      const actIndex = isAnchor ? -1 : listIdx - actOffset;

      if (typeof onFocus === 'function') {
        onFocus({ coord, kind, index: actIndex, item });
      } else if (typeof onSelect === 'function') {
        onSelect({
          coordOnly: true,
          coord,
          index: actIndex,
          item,
          source: 'timeline',
        });
      }
    };

    // Anchor kartı üzerindeki küçük rota butonu (örn. "0 → 1")
    let onAnchorRoute = null;
    if (isAnchor) {
      const k = getAnchorKind(item);
      const next = listData[listIdx + 1];
      const prev = listData[listIdx - 1];

      if (k === 'start' && next && !isAnchorItem(next)) {
        onAnchorRoute = () => callPair(listIdx, listIdx + 1);
      } else if (k === 'end' && prev && !isAnchorItem(prev)) {
        onAnchorRoute = () => callPair(listIdx - 1, listIdx);
      } else if (k === 'lodging') {
        const hasNext = next && !isAnchorItem(next);
        const hasPrev = prev && !isAnchorItem(prev);
        if (hasPrev && hasNext) {
          const fromReal = listIdx - 1 - actOffset;
          const toReal = listIdx + 1 - actOffset;
          onAnchorRoute = () => {
            const beforeLabel = `Durak ${fromReal + 1} → Konaklama`;
            const afterLabel = `Konaklama → Durak ${toReal + 1}`;
            Alert.alert('Rota', 'Hangi yön?', [
              {
                text: beforeLabel,
                onPress: () => callPair(listIdx - 1, listIdx),
              },
              {
                text: afterLabel,
                onPress: () => callPair(listIdx, listIdx + 1),
              },
              { text: 'Vazgeç', style: 'cancel' },
            ]);
          };
        } else if (hasNext) {
          onAnchorRoute = () => callPair(listIdx, listIdx + 1);
        } else if (hasPrev) {
          onAnchorRoute = () => callPair(listIdx - 1, listIdx);
        }
      }
    }

    return (
      <View key={item._key}>
        <RowCore
          item={item}
          index={isAnchor ? listIdx : listIdx - actOffset}
          selected={!!selected}
          onPress={onPress}
          onReplace={
            isAnchor ? undefined : () => onEditAt?.(listIdx - actOffset)
          }
          onDeleteAsk={
            isAnchor
              ? undefined
              : () => {
                  const nm = rowName(item, listIdx);
                  const realIdx = listIdx - actOffset;
                  askDelete(nm, realIdx);
                }
          }
          drag={isAnchor ? undefined : drag}
          isActive={isActive}
          onOpenMenu={isAnchor ? undefined : openMenu}
          onAnchorRoute={onAnchorRoute}
        />

        {renderConnectorBetween(listIdx)}

        <Separator
          insertIndex={Math.max(0, listIdx + 1 - actOffset)}
          onInsert={onInsert}
          highlight={insertMode}
        />
      </View>
    );
  };

  const renderDraggable =
    DraggableFlatList && (
      <DraggableFlatList
        data={listData}
        keyExtractor={(item) => item._key}
        activationDistance={12}
        onDragEnd={({ from, to }) => {
          const fromIsAnchor = isAnchorItem(listData[from]);
          const toIsAnchor = isAnchorItem(listData[to]);
          if (fromIsAnchor || toIsAnchor) return;
          const adjFrom = from - actOffset;
          const adjTo = to - actOffset;
          if (adjFrom != null && adjTo != null) onReorder?.(adjFrom, adjTo);
        }}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
        extraData={dayIndex}
      />
    );

  return (
    <View style={styles.openWrap}>
      {renderDraggable || (
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          {listData.map((item, index) => renderItem({ item, index }))}
          {(day?.activities || []).length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="map" size={18} color="#9CA3AF" />
              <View style={{ height: 4 }} />
              <Ionicons name="map" size={0} />
            </View>
          )}
        </View>
      )}

      <MiniSheet
        visible={sheetVisible}
        title={sheetTitle}
        onReplace={() => sheetCallbacks.current.onReplace?.()}
        onDeleteAsk={() => sheetCallbacks.current.onDeleteAsk?.()}
        onClose={closeMenu}
      />

      <ConfirmDialog
        visible={confirmVisible}
        title="Durağı sil"
        message="Bu durağı silmek istediğine emin misin?"
        confirmText="Sil"
        cancelText="Vazgeç"
        onConfirm={() => confirmCb.current.onConfirm?.()}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}
