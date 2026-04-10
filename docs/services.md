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

Registered with `react-native-track-player` as the background playback handler. Listens for remote control events (lock screen, headphones, notification) and forwards them to TrackPlayer.

Handled events: RemotePlay, RemotePause, RemoteStop, RemoteNext, RemotePrevious, RemoteSeek, RemoteJumpForward (+30s), RemoteJumpBackward (-30s).

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
- **iOS (Local)**: Copies audio files into `{documentDirectory}/audiobooks/book_{id}/` for reliable playback access.

## Database (`services/database.ts`)

Provides all data access functions for the app. Uses a module-level singleton pattern - the database connection is created once and reused.

See [Database Schema](./database.md) for table definitions and key queries.
