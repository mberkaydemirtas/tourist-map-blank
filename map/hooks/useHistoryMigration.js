// hooks/useHistoryMigration.js
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';


/**
* One-shot migration for AsyncStorage history/favorites shape.
* Mount this hook once in MapScreen to normalize legacy data.
*/
export function useHistoryMigration() {
useEffect(() => {
const HISTORY_KEYS_OBJECT = [
'route_stop_history',
'favorite_places',
'favorite_places_from',
'favorite_places_to',
'route_stop_favorites',
];
const HISTORY_KEYS_LABEL = [
'search_history',
'search_history_from',
'search_history_to',
];


const migrateHistory = async () => {
try {
for (const k of HISTORY_KEYS_LABEL) {
const raw = await AsyncStorage.getItem(k);
if (!raw) continue;
let arr = JSON.parse(raw);
if (!Array.isArray(arr)) continue;
const containsObject = arr.some(x => x && typeof x === 'object');
if (containsObject) {
const next = arr
.map(x => {
if (typeof x === 'string') return x;
if (!x || typeof x !== 'object') return null;
return x.description || x.name || x.address || '';
})
.filter(Boolean);
await AsyncStorage.setItem(k, JSON.stringify(next));
}
}
for (const k of HISTORY_KEYS_OBJECT) {
const raw = await AsyncStorage.getItem(k);
if (!raw) continue;
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) continue;
}
} catch (e) {
console.warn('history migration error', e);
}
};


migrateHistory();
}, []);
}