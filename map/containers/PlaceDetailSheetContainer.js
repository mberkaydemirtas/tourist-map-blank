// src/containers/PlaceDetailSheetContainer.js
import React, { forwardRef, useRef, useImperativeHandle, useCallback } from 'react';
import PlaceDetailSheet from '../components/PlaceDetailSheet';

const PlaceDetailSheetContainer = forwardRef(function PlaceDetailSheetContainer(
  {
    map,
    picker,
    navigation,
    onGetDirections,
    snapPoints = ['30%', '60%', '75%', '90%'],
    onOpen,
    onClose,
  },
  ref
) {
  const innerRef = useRef(null);
  const lastOpenAtRef = useRef(0);

  const safeOpen = useCallback(() => {
    lastOpenAtRef.current = Date.now();
    onOpen && onOpen();
  }, [onOpen]);

  const safeClose = useCallback(() => {
    onClose && onClose();
  }, [onClose]);

  useImperativeHandle(
    ref,
    () => ({
      snapToIndex: (i) => {
        innerRef.current?.snapToIndex?.(i);
        if (typeof i === 'number' && i >= 0) safeOpen();
        if (i === -1) safeClose();
      },
      expand: () => {
        innerRef.current?.expand?.();
        safeOpen();
      },
      close: () => {
        innerRef.current?.close?.();
        safeClose();
      },
      collapse: () => {
        innerRef.current?.collapse?.();
      },
    }),
    [safeOpen, safeClose]
  );

  // onChange guard: açıldıktan kısa süre içinde gelen -1'i yok say
  const handleChange = useCallback(
    (index) => {
      if (typeof index !== 'number') return;
      if (index >= 0) {
        safeOpen();
        return;
      }
      if (index === -1) {
        const justOpened = Date.now() - lastOpenAtRef.current < 300;
        if (justOpened) return; // bounce close'u yut
        safeClose();
      }
    },
    [safeOpen, safeClose]
  );

  // DİKKAT: Artık dismiss'te de bounce guard var.
  const handleDismiss = useCallback(() => {
    const justOpened = Date.now() - lastOpenAtRef.current < 300;
    if (justOpened) return; // ani kapanışları görmezden gel
    // kullanıcı gerçekten kapattıysa marker'ı temizleyelim ki tekrar auto-open olmasın
    map.setMarker(null);
    map.setQuery('');
    safeClose();
  }, [map, safeClose]);

  const overrideCtaLabel = picker
    ? picker.which === 'start'
      ? 'Başlangıç ekle'
      : picker.which === 'end'
      ? 'Bitiş ekle'
      : 'Konaklama ekle'
    : undefined;

  const overrideCtaOnPress = picker
    ? () => {
        const p = map.marker || {};
        const loc =
          p.location ||
          p.geometry?.location ||
          (p.coordinate && { lat: p.coordinate.latitude, lng: p.coordinate.longitude }) ||
          null;

        const hub = {
          name: p.name || p.title || 'Seçilen Nokta',
          place_id: p.place_id || p.id || null,
          location: loc,
        };

        navigation?.navigate('Gezilerim', {
          screen: 'CreateTripWizard',
          params: { pickFromMap: { which: picker.which, cityKey: picker.cityKey, hub } },
        });
      }
    : undefined;

  return (
    <PlaceDetailSheet
      ref={innerRef}
      marker={map.marker}
      routeInfo={map.routeInfo}
      snapPoints={snapPoints}
      onGetDirections={onGetDirections}
      overrideCtaLabel={overrideCtaLabel}
      overrideCtaOnPress={overrideCtaOnPress}
      onDismiss={handleDismiss}
      onChange={handleChange}   // <-- önemli: guard burada devrede
    />
  );
});

export default PlaceDetailSheetContainer;
