// map/components/MapHeaderControls.js
import React, { useEffect, useRef, useState, useCallback } from 'react';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';
import ScanButton from './ScanButton';

function MapHeaderControls({
  query,                 // sadece başlangıç değeri olarak alınacak
  onQueryChange,         // ebeveyne bildirim (debounce'lu)
  onPlaceSelect,
  onCategorySelect,
  mapMovedAfterDelay,    // 2 saniye sonra hareketi kontrol eden prop
  loadingCategory,
  onSearchArea,
  activeCategory,
}) {
  // 👉 Yerel state: input'un tek doğrusu burası
  const [localQuery, setLocalQuery] = useState(query ?? '');
  const debounceRef = useRef(null);
  const mountedRef = useRef(false);

  // İlk mount'ta dışarıdan gelen query'yi yükle, sonrasında DIŞARIYI YOK SAY
  useEffect(() => {
    if (!mountedRef.current) {
      setLocalQuery(query ?? '');
      mountedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <- bilerek sadece ilk mount

  // Kullanıcı yazdıkça lokal state'i güncelle, 250ms sonra ebeveyne ilet.
  const handleLocalChange = useCallback((text) => {
    setLocalQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onQueryChange?.(text);
    }, 250);
  }, [onQueryChange]);

  // Geçmiş/öneriden seçim: input metnini de güncelle
  const handleSelect = useCallback((item) => {
    const text =
      item?.description ??
      item?.name ??
      item?.title ??
      (typeof item === 'string' ? item : '') ??
      '';
    if (text) {
      setLocalQuery(text);
      // seçimi de ebeveyne iletelim (mevcut davranış)
      onQueryChange?.(text);
    }
    onPlaceSelect?.(item);
  }, [onPlaceSelect, onQueryChange]);

  // Unmount temizliği
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <>
      <SearchBar
        value={localQuery}         // ❗ tamamen yerel kontrol
        onChange={handleLocalChange}
        onSelect={handleSelect}
      />

      <CategoryBar
        activeCategory={activeCategory}
        onSelect={onCategorySelect}
      />

      {/*
        'Bu bölgeyi tara' butonu:
        - Kategori seçildiyse (activeCategory)
        - Harita 2 saniyelik delay sonrası hareket ettiyse (mapMovedAfterDelay)
        - Yükleme yapılmıyorsa (!loadingCategory)
      */}
      {activeCategory && mapMovedAfterDelay && !loadingCategory && (
        <ScanButton onPress={onSearchArea} />
      )}
    </>
  );
}

export default React.memo(MapHeaderControls);

