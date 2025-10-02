// src/localDrivers/plansKVDriver.js
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function plansKVDriver() {
  return {
    async get(key) {
      const raw = await AsyncStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value) {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    },
    async remove(key) {
      await AsyncStorage.removeItem(key);
      return true;
    },
  };
}
