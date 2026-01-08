// app/screens/TripPlacesScreen.js
import React, { useEffect, useState } from "react";
import TripPlaceSelection from "../components/TripPlaceSelection";
import { resolvePlacesBatch } from "../services/placeResolver";
import { API_BASE } from "../../app/lib/api";

export default function TripPlacesScreen() {
  const [initialData, setInitialData] = useState([]);

  useEffect(() => {
    // Örn: setInitialData(osmArrayFromDB);
  }, []);

  // Google arama: server üzerinden
  const googleSearchFn = async (q, ctx) => {
    try {
      const qq = (q || "").trim();
      if (qq.length < 2) return [];

      const url =
        `${API_BASE}/api/poi/google/search` +
        `?q=${encodeURIComponent(qq)}` +
        `&lat=${ctx.lat}&lon=${ctx.lon}` +
        `&city=${encodeURIComponent(ctx.city || "")}` +
        `&category=${encodeURIComponent(ctx.category || "")}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`poiSearch_failed_${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn("googleSearchFn error:", err?.message || err);
      return [];
    }
  };

  const onConfirm = async (selected) => {
    try {
      const resolved = await resolvePlacesBatch({
        items: selected,
        city: "Ankara",
        API_BASE,
      });
      console.log("Resolved places:", resolved);
      // TODO: wizard/route state’ine yaz
    } catch (err) {
      console.warn("onConfirm error:", err?.message || err);
    }
  };

  return (
    <TripPlaceSelection
      city="ankara"
      initialData={initialData}
      googleSearchFn={googleSearchFn}
      onConfirm={onConfirm}
    />
  );
}
