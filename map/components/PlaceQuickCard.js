// map/components/PlaceQuickCard
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const C = {
  card: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fg2: '#6B7280',
  primary: '#111827',
};

function normalizePhotos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(p => (typeof p === 'string' ? p : (p?.url || p?.uri)))
    .filter(Boolean);
}

export default function PlaceQuickCard({
  visible,
  marker,
  onDismiss,
  onCtaPress,
  ctaLabel = 'Ekle',
  ctaDisabled = false,
  variant = 'add',            // 'add' | 'preview'
  metaLabel = '',
}) {
  const insets = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;

  const name = String(marker?.name || 'Seçilen konum');
  const address = String(marker?.address || '');
  // 📸 hızlı fallback (marker.icon/coverPhoto/photoUrl gibi alanları da dene)
  const photos = (() => {
    const p = normalizePhotos(marker?.photoUrls);
    if (p.length) return p;
    const extras = [marker?.icon, marker?.coverPhoto, marker?.photoUrl].filter(Boolean);
    return normalizePhotos(extras);
  })();

  const hasCoords = !!(marker?.coords && Number.isFinite(marker.coords.latitude) && Number.isFinite(marker.coords.longitude));
  const isPreview = variant === 'preview';

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 140 : 110,        // ⚡ hızlandırıldı
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const cardStyle = useMemo(() => ([
    styles.card,
    { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }, // 24→16
  ]), [a]);

  if (!visible) return <View pointerEvents="none" style={StyleSheet.absoluteFill} />;

  const handleCta = () => { if (!ctaDisabled) onCtaPress?.(marker || {}); };

  return (
    // Backdrop yok: arka plan interaktif kalsın
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
        <Animated.View style={cardStyle} pointerEvents="auto">
          <View style={styles.top}>
            <View style={{ flex: 1, paddingRight: 6 }}>
              <Text numberOfLines={1} style={styles.title}>{name}</Text>
              {!!metaLabel && <Text numberOfLines={1} style={styles.meta}>{metaLabel}</Text>}
            </View>
            <Pressable onPress={onDismiss} hitSlop={8} style={styles.close} accessibilityLabel="Kapat">
              <Ionicons name="close" size={18} color={C.fg} />
            </Pressable>
          </View>

          {!!address && <Text numberOfLines={2} style={styles.addr}>{address}</Text>}
          {hasCoords && (
            <Text numberOfLines={1} style={styles.coord}>
              {marker.coords.latitude.toFixed(5)}, {marker.coords.longitude.toFixed(5)}
            </Text>
          )}

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.scroller}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
            >
              {photos.slice(0, 6).map((uri, i) => (
                <Image
                  key={`${uri}-${i}`}
                  source={{ uri: String(uri) }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}

          {!isPreview && (
            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.secondary]} onPress={onDismiss}>
                <Text style={styles.btnT2}>Vazgeç</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.primary, ctaDisabled && styles.btnDisabled]}
                onPress={handleCta}
                disabled={ctaDisabled}
              >
                <Ionicons name="add" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnT1}>{ctaLabel}</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  card: {
    width: '96%', maxWidth: 640, backgroundColor: C.card, borderRadius: 14,
    padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  title: { color: C.fg, fontWeight: '800', fontSize: 16 },
  meta: { color: C.fg2, fontSize: 12, marginTop: 2 },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  addr: { color: C.fg2, marginTop: 8 },
  coord: { color: C.fg2, marginTop: 2, fontSize: 12 },
  scroller: { marginTop: 10, minHeight: 82 },
  photo: { width: 110, height: 80, borderRadius: 8, backgroundColor: '#F3F4F6' },
  actions: { marginTop: 10, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  secondary: { backgroundColor: '#F3F4F6' },
  primary: { backgroundColor: C.primary },
  btnDisabled: { opacity: 0.6 },
  btnT2: { color: C.fg, fontWeight: '700' },
  btnT1: { color: '#fff', fontWeight: '800' },
});
