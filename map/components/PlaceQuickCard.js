// map/components/PlaceQuickCard.js
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
  const urls = arr
    .map(p =>
      typeof p === 'string'
        ? p
        : (p?.url || p?.uri || p?.src || p?.photoUrl)
    )
    .filter(u => !!u && /^https?:\/\//i.test(String(u)));
  return Array.from(new Set(urls));
}

export default function PlaceQuickCard({
  visible = false,
  marker,
  onDismiss,
  onCtaPress,
  ctaLabel = 'Ekle',
  ctaDisabled = false,
  variant = 'add', // 'add' | 'preview'
  metaLabel = '',
}) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  // Kart verileri
  const name = String(marker?.name || 'Seçilen konum');
  const address = String(marker?.address || '');

  // 🔧 Foto kaynağını genişlettik
  const photos = useMemo(() => {
    // 1) En önce doğrudan verilen photoUrls
    let collected = normalizePhotos(marker?.photoUrls);
    if (collected.length) return collected;

    // 2) Eğer marker.photos varsa (örneğin [{url: ...}])
    collected = normalizePhotos(marker?.photos);
    if (collected.length) return collected;

    // 3) place içinden gelebilecek varyantlar
    collected = normalizePhotos(marker?.place?.photoUrls);
    if (collected.length) return collected;

    collected = normalizePhotos(marker?.place?.photos);
    if (collected.length) return collected;

    // 4) Son çare: icon / coverPhoto / photoUrl
    const extras = [marker?.icon, marker?.coverPhoto, marker?.photoUrl].filter(Boolean);
    return normalizePhotos(extras);
  }, [
    marker?.photoUrls,
    marker?.photos,
    marker?.place?.photoUrls,
    marker?.place?.photos,
    marker?.icon,
    marker?.coverPhoto,
    marker?.photoUrl,
  ]);

  const hasCoords =
    !!(marker?.coords &&
      Number.isFinite(Number(marker.coords.latitude)) &&
      Number.isFinite(Number(marker.coords.longitude)));

  const isPreview = variant === 'preview';

  // Animasyon
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 140 : 110,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const cardStyle = useMemo(
    () => ([
      styles.card,
      {
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [16, 0],
            }),
          },
        ],
      },
    ]),
    [anim]
  );

  const handleCta = () => {
    if (!ctaDisabled) onCtaPress?.(marker || {});
  };

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        visible ? { zIndex: 9999, elevation: 9999 } : { zIndex: -1, elevation: 0 },
      ]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {visible && (
        <View
          style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[cardStyle, { zIndex: 10000, elevation: 10000 }]}
            pointerEvents="auto"
          >
            {/* Üst Başlık */}
            <View style={styles.top}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text numberOfLines={1} style={styles.title}>
                  {name}
                </Text>
                {!!metaLabel && (
                  <Text numberOfLines={1} style={styles.meta}>
                    {String(metaLabel)}
                  </Text>
                )}
              </View>

              <Pressable
                onPress={onDismiss}
                hitSlop={8}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={18} color={C.fg} />
              </Pressable>
            </View>

            {!!address && (
              <Text numberOfLines={2} style={styles.addr}>
                {address}
              </Text>
            )}

            {hasCoords && (
              <Text numberOfLines={1} style={styles.coord}>
                {Number(marker.coords.latitude).toFixed(5)},{' '}
                {Number(marker.coords.longitude).toFixed(5)}
              </Text>
            )}

            {/* Fotoğraflar (varsa) */}
            {photos.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.scroller}
                contentContainerStyle={styles.scrollerContent}
              >
                {photos.slice(0, 2).map((uri, i) => (
                  <Image
                    key={`${uri}-${i}`}
                    source={{ uri: String(uri) }}
                    style={[styles.photo, i > 0 && { marginLeft: 8 }]}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            )}

            {/* Eylem Butonları */}
            {!isPreview && (
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.secondary]}
                  onPress={onDismiss}
                  accessibilityRole="button"
                >
                  <Text style={styles.btnT2}>Vazgeç</Text>
                </Pressable>

                <View style={{ width: 8 }} />

                <Pressable
                  style={[
                    styles.btn,
                    styles.primary,
                    ctaDisabled && styles.btnDisabled,
                  ]}
                  onPress={handleCta}
                  disabled={ctaDisabled}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="add"
                    size={16}
                    color="#fff"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.btnT1}>{String(ctaLabel)}</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  card: {
    width: '96%',
    maxWidth: 640,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10000, // Map & overlay üstü
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  title: { color: C.fg, fontWeight: '800', fontSize: 16 },
  meta: { color: C.fg2, fontSize: 12, marginTop: 2 },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  addr: { color: C.fg2, marginTop: 8 },
  coord: { color: C.fg2, marginTop: 2, fontSize: 12 },
  scroller: { marginTop: 10, minHeight: 82 },
  scrollerContent: { paddingVertical: 2, paddingRight: 2 },
  photo: {
    width: 110,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  actions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  btn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondary: { backgroundColor: '#F3F4F6' },
  primary: { backgroundColor: C.primary },
  btnDisabled: { opacity: 0.6 },
  btnT2: { color: C.fg, fontWeight: '700' },
  btnT1: { color: '#fff', fontWeight: '800' },
});
