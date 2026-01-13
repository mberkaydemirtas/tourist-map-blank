// map/components/MapHeaderControls.js
import React, { useEffect, useRef, useState, useCallback } from 'react';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';
import ScanButton from './ScanButton';

function MapHeaderControls({
  query,
  onQueryChange,
  onPlaceSelect,
  onCategorySelect,
  mapMovedAfterDelay,
  loadingCategory,
  onSearchArea,
  activeCategory,

  // ✅ ekle
  searchCountryCode,
  searchLanguage,
  searchBiasCenter,
  searchRadius,
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
      value={localQuery}
      onChange={handleLocalChange}
      onSelect={handleSelect}

      // ✅ ekle
      searchCountryCode={searchCountryCode}
      searchLanguage={searchLanguage}
      searchBiasCenter={searchBiasCenter}
      searchRadius={searchRadius}
    />

      <CategoryBar
        activeCategory={activeCategory}
        onSelect={onCategorySelect}
      />

      {activeCategory && mapMovedAfterDelay && !loadingCategory && (
        <ScanButton onPress={onSearchArea} />
      )}
    </>
  );
}

export default React.memo(MapHeaderControls);
