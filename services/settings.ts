import {
  DEFAULT_SKIP_SECONDS,
  DEFAULT_AUTO_REWIND_SECONDS,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_AUTO_SLEEP_ENABLED,
  DEFAULT_AUTO_SLEEP_START_MIN,
  DEFAULT_AUTO_SLEEP_END_MIN,
  DEFAULT_AUTO_SLEEP_DURATION_MIN,
} from "@/constants/playback";
import { getAllSettingsRows, setSettingValue } from "./database";

export interface AppSettings {
  // Seconds for the forward/back skip controls.
  skipSeconds: number;
  // Seconds rewound when resuming after a pause (0 = off).
  autoRewindSeconds: number;
  // Playback rate applied when a book is opened.
  defaultPlaybackSpeed: number;
  // Auto sleep timer.
  autoSleepEnabled: boolean;
  autoSleepStartMin: number; // minutes since local midnight
  autoSleepEndMin: number;
  autoSleepDurationMin: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  skipSeconds: DEFAULT_SKIP_SECONDS,
  autoRewindSeconds: DEFAULT_AUTO_REWIND_SECONDS,
  defaultPlaybackSpeed: DEFAULT_PLAYBACK_SPEED,
  autoSleepEnabled: DEFAULT_AUTO_SLEEP_ENABLED,
  autoSleepStartMin: DEFAULT_AUTO_SLEEP_START_MIN,
  autoSleepEndMin: DEFAULT_AUTO_SLEEP_END_MIN,
  autoSleepDurationMin: DEFAULT_AUTO_SLEEP_DURATION_MIN,
};

// Module-level cache so non-React consumers (the background playback service,
// the audio context callbacks) can read the current values without prop
// threading. SettingsProvider loads this on app start and keeps it fresh.
let cache: AppSettings = { ...DEFAULT_SETTINGS };
let loadPromise: Promise<AppSettings> | null = null;

function coerce(rows: { key: string; value: string }[]): AppSettings {
  const next: AppSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    // Own-property check — skips inherited names like `__proto__` /
    // `constructor` even if a row with that key sneaks into the DB.
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    try {
      const parsed = JSON.parse(value);
      // Only accept values whose type matches the default's type.
      const k = key as keyof AppSettings;
      if (typeof parsed === typeof next[k]) {
        (next as unknown as Record<string, unknown>)[k] = parsed;
      }
    } catch {
      // Ignore malformed rows; the default stays.
    }
  }
  return next;
}

// Idempotent: loads once from the DB, then returns the cache. Safe to call
// from anywhere (the background service calls it lazily).
export async function loadSettings(): Promise<AppSettings> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const rows = await getAllSettingsRows();
      cache = coerce(rows);
    } catch (e) {
      console.warn("Error loading settings, using defaults:", e);
      cache = { ...DEFAULT_SETTINGS };
    }
    return cache;
  })();
  return loadPromise;
}

export function getCachedSettings(): AppSettings {
  return cache;
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<AppSettings> {
  cache = { ...cache, [key]: value };
  await setSettingValue(key, JSON.stringify(value));
  return cache;
}

// Used by the background remote handler, which runs outside React. Always
// awaits a pending hydration so remote events don't see stale defaults during
// the brief startup window when `loadPromise` is in-flight but unresolved.
export async function getSkipSeconds(): Promise<number> {
  await (loadPromise ?? loadSettings());
  return cache.skipSeconds;
}

export async function getAutoRewindSeconds(): Promise<number> {
  await (loadPromise ?? loadSettings());
  return cache.autoRewindSeconds;
}
