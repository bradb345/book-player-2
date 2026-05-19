// Default playback values. These seed the persisted user settings
// (services/settings.ts); the live values come from there so the UI, the
// player setup, and the background remote handler stay in sync.

// Seconds skipped by the forward/back controls and the lock-screen jump
// buttons.
export const DEFAULT_SKIP_SECONDS = 30;

// Seconds rewound automatically when resuming playback after a pause.
// 0 disables auto-rewind.
export const DEFAULT_AUTO_REWIND_SECONDS = 0;

// Playback rate applied when a book is opened.
export const DEFAULT_PLAYBACK_SPEED = 1.0;

// Auto sleep timer: when enabled, playback pauses automatically after
// AUTO_SLEEP_DURATION_MIN minutes if it was started inside the
// [start, end) clock window. Times are minutes since local midnight.
export const DEFAULT_AUTO_SLEEP_ENABLED = false;
export const DEFAULT_AUTO_SLEEP_START_MIN = 22 * 60; // 22:00
export const DEFAULT_AUTO_SLEEP_END_MIN = 6 * 60; // 06:00
export const DEFAULT_AUTO_SLEEP_DURATION_MIN = 30;
