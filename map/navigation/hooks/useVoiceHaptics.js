// src/navigation/hooks/useVoiceHaptics.js
import { useCallback, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

export default function useVoiceHaptics({
  language = 'tr-TR',
  pitch = 1.0,
  rate = 1.0,
} = {}) {
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  const lastSpokeAtRef = useRef(0);
  const holdUntilRef = useRef(0);

  const say = useCallback((text) => {
    if (!text || mutedRef.current) return;
    try {
      Speech.stop();
      Speech.speak(String(text), { language, pitch, rate });
    } catch {}
  }, [language, pitch, rate]);

  const safeSay = useCallback((text, cooldownMs = 1500) => {
    const now = Date.now();
    if (now < holdUntilRef.current) return;
    if (now - lastSpokeAtRef.current < cooldownMs) return;
    lastSpokeAtRef.current = now;
    say(text);
  }, [say]);

  const hold = useCallback((ms = 1500) => {
    holdUntilRef.current = Date.now() + ms;
  }, []);

  const stopAll = useCallback(() => {
    try { Speech.stop(); } catch {}
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next) {
        try { Speech.stop(); } catch {}
      }
      return next;
    });
  }, []);

  const buzz = useCallback(async (style = Haptics.ImpactFeedbackStyle.Medium) => {
    try { await Haptics.impactAsync(style); } catch {}
  }, []);

  return {
    muted, toggleMute, setMuted, mutedRef,
    say, safeSay, stopAll, hold, buzz,
  };
}
