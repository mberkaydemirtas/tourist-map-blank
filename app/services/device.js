// app/services/device.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import 'react-native-get-random-values';
import { v4 as uuid } from "uuid";

const KEY = "device:id";

export async function getDeviceId() {
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    id = uuid();
    await AsyncStorage.setItem(KEY, id);
  }
  return id;
}
