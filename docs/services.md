# Services

## AudioContext (`services/audioContext.tsx`)

The central audio state manager, exposed as a React Context via `AudioProvider` and consumed with the `useAudio()` hook.

### State
| Field | Type | Description |
|-------|------|-------------|
| book | Book \| null | Currently loaded book |
| chapters | Chapter[] | Chapters for the current book |
| currentChapterIndex | number | Active chapter index |
| isPlaying | boolean | Whether audio is playing |
| isLoading | boolean | True during book load |
| positionMs | number | Current position in the chapter |
| durationMs | number | Current chapter duration |
| playbackSpeed | number | Playback rate (0.5 - 3.0) |
| error | string \| null | Error message if playback failed |

### Actions
| Method | Description |
|--------|-------------|
| `loadBook(bookId)` | Load a book, restore progress, build TrackPlayer queue |
| `togglePlayback()` | Play or pause |
| `play()` / `pause()` | Explicit play/pause |
| `seekTo(positionMs)` | Seek to absolute position (also saves progress) |
| `seekRelative(deltaMs)` | Skip forward/back by delta |
| `goToChapter(index, startPosition?)` | Jump to a specific chapter |
| `nextChapter()` / `previousChapter()` | Navigate chapters |
| `setPlaybackSpeed(speed)` | Change playback rate |
| `stopAndUnload()` | Stop playback, save progress, reset state |

### Internal Behavior
- **Progress save interval**: Saves position to DB every 5 seconds
- **Listening time tracking**: Accumulates real listening time (clamped to 10s max per interval to handle backgrounding), flushed to `listening_sessions` table
- **Chapter duration discovery**: Records each chapter's duration when first reported by TrackPlayer; updates book total when all chapters are known
- **Book completion**: Marks `book_history` as completed when `PlaybackQueueEnded` fires
- **Transition guard**: `isTransitioningRef` blocks saves/events during book switches

## PlaybackService (`services/playbackService.ts`)

Registered with `react-native-track-player` as the background playback handler, and the **single** place remote control events (lock screen, headphones, notification) are handled — `AudioContext` deliberately does not also handle them (doing so double-fired jump/skip). The UI stays in sync because `AudioContext` observes the resulting player state via `usePlaybackState` / `useProgress`.

Handled events: RemotePlay, RemotePause, RemoteStop, RemoteNext, RemotePrevious, RemoteSeek, RemoteJumpForward (+`SKIP_SECONDS`), RemoteJumpBackward (−`SKIP_SECONDS`). `SKIP_SECONDS` lives in `constants/playback.ts`, shared with the player UI and `TrackPlayer.updateOptions`.

## Scanner (`services/scanner.ts`)

Handles audiobook discovery and import from user-selected folders.

### Public API
| Function | Description |
|----------|-------------|
| `pickAudiobooksFolder()` | Opens platform folder picker, returns URI and name |
| `scanAndImportFolder(folderUri)` | Scans a folder and imports discovered audiobooks |
| `deleteBookFiles(bookId)` | Cleans up copied files for a deleted book (iOS only) |

### Import Logic
1. Reads folder contents (SAF on Android, FileSystem on iOS)
2. Categorizes files as audio, image, or subdirectory
3. Each subdirectory is treated as a multi-chapter book
4. Loose audio files in the root become single-chapter books
5. Cover images are detected by common filenames (cover, folder, front, album, artwork)
6. Skips books that already exist (matched by `folder_path`)

### Platform Differences
- **Android (SAF)**: Plays audio directly from `content://` URIs. No file copying.
- **iOS (Local)**: `pickAudiobooksFolder()` uses `@react-native-documents/picker` `pickDirectory({ requestLongTermAccess: true })`, which holds the iOS security scope for the app process across the picker call. `scanAndImportFolder()` then enumerates the tree with `expo-file-system` and copies every audio file into `{documentDirectory}/audiobooks/book_{id}/`. It deliberately does **not** call `releaseSecureAccess()`: in `@react-native-documents/picker` 12.0.1 that native call hard-crashes the app under the New Architecture (an uncatchable native crash), so the process-scoped security handle is intentionally leaked and left for iOS to reclaim when the process exits. Because playback uses the copies and the long-term bookmark is never persisted, iOS rescan/sync of an already-added folder can't see new files (the original scope is gone). This is the same "iOS sync is a follow-up" limitation noted below.

## Sync (`services/sync.ts`)

`syncLibrary()` keeps the DB in step with what's on disk (modeled on Voice's
MediaScanner). Triggered on home-screen focus and pull-to-refresh:

- Imports brand-new book folders (the scan is idempotent).
- Reconciles existing SAF books whose chapter files changed (add/remove
  chapters while preserving playback progress).
- Hides books whose folders/files vanished (`is_active = 0`) instead of
  deleting them, and restores them if the files come back.
- One-time repair of titles mangled by the old SAF URI-decoding bug.

Scope is the Android/SAF "no-copy" model where `chapters.file_path` is the real
source URI and can be diffed against the filesystem; iOS sync is a follow-up.

## Database (`services/database.ts`)

Provides all data access functions for the app. Uses a module-level singleton pattern - the database connection is created once and reused.

See [Database Schema](./database.md) for table definitions and key queries.
