// app/services/tripsSync.js
import { Platform } from "react-native";
import { getDirtyChanges, applyServerRows, setLastSync, getLastSync } from "../lib/tripsLocal";
import { API_BASE } from "../lib/api";

export async function syncTrips({ deviceId }) {
  const since = await getLastSync();
  const changes = await getDirtyChanges();

  const res = await fetch(`${API_BASE}/api/trips/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-id": deviceId },
    body: JSON.stringify({ since, changes })
  });

  if (!res.ok) throw new Error(`sync_failed_${res.status}`);
  const json = await res.json();

  await applyServerRows(json.serverChanges || []);
  if (json.serverTime) await setLastSync(json.serverTime);
  return json;
}
