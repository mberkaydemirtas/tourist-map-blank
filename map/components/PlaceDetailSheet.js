// src/components/PlaceDetailSheet.js
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import PlaceDetailHeader from './PlaceDetailHeader';
import PlaceOpeningHours from './PlaceOpeningHours';
import PlacePhotoGallery from './PlacePhotoGallery';
import PlaceContactButtons from './PlaceContactButtons';
import { toCoordsObject, normalizeCoord } from '../utils/coords';

// ✅ server base (senin mevcut api.js’inden)
import { API_BASE, API_TIMEOUT_MS } from '../../app/lib/api';

const DETAILS_TTL_MS = 10 * 60 * 1000; // 10dk
const detailsCache = new Map(); // place_id -> { exp, data }

function mergeMarkerWithDetails(marker, details) {
  if (!marker) return marker;
  if (!details) return marker;

  // server result shape: { place_id, name, formatted_address, website, ... opening_hours, geometry, url }
  const merged = { ...marker };

  // isim/adres: mevcut yoksa doldur
  if (!merged.name && details.name) merged.name = details.name;
  if (!merged.address && details.formatted_address) merged.address = details.formatted_address;
  if (!merged.formatted_address && details.formatted_address) merged.formatted_address = details.formatted_address;

  // phone/website/url
  if (!merged.website && details.website) merged.website = details.website;
  if (!merged.url && details.url) merged.url = details.url;

  if (!merged.formatted_phone_number && details.formatted_phone_number) {
    merged.formatted_phone_number = details.formatted_phone_number;
  }
  if (!merged.international_phone_number && details.international_phone_number) {
    merged.international_phone_number = details.international_phone_number;
  }

  // rating vb
  if (merged.rating == null && details.rating != null) merged.rating = details.rating;
  if (merged.user_ratings_total == null && details.user_ratings_total != null) {
    merged.user_ratings_total = details.user_ratings_total;
  }
  if (merged.price_level == null && details.price_level != null) merged.price_level = details.price_level;

  // opening_hours
  if (!merged.opening_hours && details.opening_hours) merged.opening_hours = details.opening_hours;

  // geometry/location → coords
  const lat = details?.geometry?.location?.lat;
  const lng = details?.geometry?.location?.lng;
  const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

  if (hasCoords) {
    merged.coords = normalizeCoord({ lat: Number(lat), lng: Number(lng) });
  } else if (!merged.coords) {
    // marker’dan normalize etmeyi dene
    merged.coords = normalizeCoord(merged?.coords ?? merged?.coordinate ?? merged?.geometry?.location ?? merged);
  }

  // types
  if (!merged.types && Array.isArray(details.types)) merged.types = details.types;

  // (opsiyonel) photos_count gibi alanlar
  if (merged.photos_count == null && details.photos_count != null) merged.photos_count = details.photos_count;

  return merged;
}

async function fetchPlaceDetails(placeId, { signal, timeoutMs } = {}) {
  const pid = String(placeId || '').trim();
  if (!pid) return null;

  const now = Date.now();
  const cached = detailsCache.get(pid);
  if (cached && cached.exp > now) return cached.data;

  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : (API_TIMEOUT_MS || 15000);

  const u = new URL(`${API_BASE}/api/places/details`);
  u.searchParams.set('place_id', pid);
  u.searchParams.set('lang', 'tr');

  // timeout + abort
  const ctrl = new AbortController();
  const onUpstreamAbort = () => ctrl.abort();

  let timer = null;
  if (T > 0) timer = setTimeout(() => ctrl.abort(), T);

  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onUpstreamAbort, { once: true });
  }

  try {
    const res = await fetch(String(u), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.ok || !json?.result) return null;

    detailsCache.set(pid, { exp: now + DETAILS_TTL_MS, data: json.result });
    return json.result;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) {
      try { signal.removeEventListener('abort', onUpstreamAbort); } catch {}
    }
  }
}

const PlaceDetailSheet = forwardRef(function PlaceDetailSheet(
  {
    marker,
    routeInfo,
    snapPoints = ['30%', '60%', '75%', '90%'],
    onGetDirections,
    onDismiss,
    overrideCtaLabel,
    overrideCtaOnPress,
    onChange,
  },
  ref
) {
  const innerRef = useRef(null);

  // ✅ details state
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // request cancel
  const detailsAbortRef = useRef(null);
  const lastPidRef = useRef(null);

  useImperativeHandle(ref, () => ({
    present: () => innerRef.current?.expand?.(),
    close: () => innerRef.current?.close?.(),
    snapToIndex: (index) => innerRef.current?.snapToIndex?.(index),
  }));

  // ✅ marker seçilince details çek
  useEffect(() => {
    const pid = marker?.place_id || marker?.placeId || null;

    // marker yoksa temizle
    if (!marker) {
      setDetails(null);
      setDetailsLoading(false);
      lastPidRef.current = null;
      if (detailsAbortRef.current) {
        try { detailsAbortRef.current.abort(); } catch {}
        detailsAbortRef.current = null;
      }
      return;
    }

    // place_id yoksa da temizle (local item olabilir)
    if (!pid) {
      setDetails(null);
      setDetailsLoading(false);
      lastPidRef.current = null;
      if (detailsAbortRef.current) {
        try { detailsAbortRef.current.abort(); } catch {}
        detailsAbortRef.current = null;
      }
      return;
    }

    // aynı pid için tekrar fetch etme (marker render tekrarlarında)
    if (lastPidRef.current === pid && (details || detailsLoading)) {
      return;
    }
    lastPidRef.current = pid;

    // önceki isteği iptal et
    if (detailsAbortRef.current) {
      try { detailsAbortRef.current.abort(); } catch {}
      detailsAbortRef.current = null;
    }

    const ctrl = new AbortController();
    detailsAbortRef.current = ctrl;

    setDetailsLoading(true);
    setDetails(null);

    (async () => {
      const d = await fetchPlaceDetails(pid, { signal: ctrl.signal, timeoutMs: 12000 });
      if (ctrl.signal.aborted) return;

      setDetails(d);
      setDetailsLoading(false);
      detailsAbortRef.current = null;
    })();

    return () => {
      try { ctrl.abort(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker?.place_id, marker?.placeId]);

  // ✅ sheet’te kullanılacak marker = zenginleştirilmiş marker
  const mergedMarker = useMemo(() => {
    return mergeMarkerWithDetails(marker, details);
  }, [marker, details]);

  const handleGetDirectionsPress = () => {
    if (!mergedMarker || !onGetDirections) return;
    const normalized =
      toCoordsObject(mergedMarker) ??
      {
        ...mergedMarker,
        coords: normalizeCoord(
          mergedMarker?.coords ??
            mergedMarker?.coordinate ??
            mergedMarker?.geometry?.location ??
            mergedMarker
        ),
      };
    onGetDirections(normalized);
  };

  const primaryCtaHandler = () => {
    if (typeof overrideCtaOnPress === 'function') {
      overrideCtaOnPress(mergedMarker);
    } else {
      handleGetDirectionsPress();
    }
  };
  const primaryCtaLabel = overrideCtaLabel || 'Yol Tarifi Al';

  return (
    <BottomSheet
      ref={innerRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableContentPanningGesture={false}
      enableHandlePanningGesture
      onChange={onChange}
      onClose={() => { typeof onDismiss === 'function' && onDismiss(); }}
      handleComponent={() => (
        <PlaceDetailHeader
          marker={mergedMarker}
          routeInfo={routeInfo}
          onGetDirections={primaryCtaHandler}
          ctaLabel={primaryCtaLabel}
        />
      )}
    >
      <BottomSheetScrollView contentContainerStyle={styles.sheetScroll} nestedScrollEnabled>
        {!!mergedMarker && (
          <>
            {/* ✅ details loading indicator */}
            {detailsLoading ? (
              <View style={styles.detailsLoadingRow}>
                <ActivityIndicator />
                <Text style={styles.detailsLoadingText}>Detaylar yükleniyor…</Text>
              </View>
            ) : null}

            {/* Artık alt komponentler daha dolu marker görür */}
            <PlaceOpeningHours marker={mergedMarker} />
            <PlacePhotoGallery marker={mergedMarker} />
            <PlaceContactButtons marker={mergedMarker} />
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

export default PlaceDetailSheet;

const styles = StyleSheet.create({
  sheetScroll: { padding: 20, paddingBottom: 40 },
  detailsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginBottom: 6,
  },
  detailsLoadingText: { color: '#6B7280', fontWeight: '700' },
});
