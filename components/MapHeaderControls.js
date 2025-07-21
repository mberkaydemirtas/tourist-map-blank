// MapHeaderControls.js
import React from 'react';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';
import ScanButton from './ScanButton';

export default function MapHeaderControls({
  query,
  onQueryChange,
  onPlaceSelect,
  onCategorySelect,
  mapMoved,
  loadingCategory,
  onSearchArea,
}) {
  return (
    <>
      <SearchBar
        value={query}
        onChange={onQueryChange}
        onSelect={onPlaceSelect}
      />

      <CategoryBar onSelect={onCategorySelect} />

      {mapMoved && !loadingCategory && (
        <ScanButton onPress={onSearchArea} />
      )}
    </>
  );
}
