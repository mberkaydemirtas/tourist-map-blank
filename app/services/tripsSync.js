// app/services/tripsSync.js
import { Platform } from "react-native";
import { getDirtyChanges, applyServerRows, setLastSync, getLastSync } from "../lib/tripsLocal";
import { API_BASE } from "../lib/api";

  export async function syncTrips({ deviceId }) {
   // Server kapalıysa hiç deneme
   if (!API_BASE || API_BASE.trim() === "") return { applied: [], conflicts: [], serverChanges: [] };
  const since = await getLastSync();
  const changes = await getDirtyChanges();

   // 3 sn timeout’lu fetch
   const ctrl = new AbortController();
   const t = setTimeout(() => ctrl.abort(), 3000);
   const res = await fetch(`${API_BASE}/api/trips/sync`, {    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-id": deviceId },
     body: JSON.stringify({ since, changes }),
     signal: ctrl.signal,     }).catch(() => null);
  clearTimeout(t);
  if (!res) throw new Error("sync_failed_timeout");
  
  if (!res.ok) throw new Error(`sync_failed_${res.status}`);
  const json = await res.json();

  await applyServerRows(json.serverChanges || []);
  if (json.serverTime) await setLastSync(json.serverTime);
  return json;
}
