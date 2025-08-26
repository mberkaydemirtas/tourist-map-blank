// Basit, güvenli formatlayıcılar (TR odaklı)

export const metersFmt = (m) => {
  if (m == null || !Number.isFinite(m)) return "";
  if (m >= 1000) {
    const km = m / 1000;
    return `${km.toFixed(km >= 2 ? 0 : 1)} km`;
  }
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(1, Math.round(m))} m`;
};

export const formatDurationShort = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h >= 1 ? `${h} sa ${m} dk` : `${m} dk`;
};

export const formatETA = (sec, locale = "tr-TR") => {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const d = new Date(Date.now() + Math.max(0, sec) * 1000);
  try {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    // RN ortamında locale fallback
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
};

export const formatAltComparison = (baseSec, altSec) => {
  if (!Number.isFinite(baseSec) || !Number.isFinite(altSec)) {
    return { text: "—", tone: "neutral" };
  }
  const diff = Math.round(altSec - baseSec);
  const ad = Math.abs(diff);
  if (ad < 45) return { text: "aynı süre", tone: "neutral" };
  const mins = Math.max(1, Math.round(ad / 60));
  return diff < 0
    ? { text: `${mins} dk daha hızlı`, tone: "faster" }
    : { text: `${mins} dk daha yavaş`, tone: "slower" };
};
