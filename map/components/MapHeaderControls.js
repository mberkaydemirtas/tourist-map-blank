import React from 'react';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';
import ScanButton from './ScanButton';

export default function MapHeaderControls({
  query,
  onQueryChange,
  onPlaceSelect,
  onCategorySelect,
  mapMovedAfterDelay, // 2 saniye sonra hareketi kontrol eden prop
  loadingCategory,
  onSearchArea,
  activeCategory,
}) {
  return (
    <>
      <SearchBar
        value={query}
        onChange={onQueryChange}
        onSelect={onPlaceSelect}
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
