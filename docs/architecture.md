# Architecture

Book Player 2 is a React Native audiobook player built with Expo. It supports Android (via Storage Access Framework) and iOS (via local file system copying).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo SDK 54 |
| Navigation | Expo Router (file-based) |
| Database | expo-sqlite (SQLite WAL mode) |
| Audio | react-native-track-player |
| Charts | react-native-gifted-charts |
| UI | React Native core + @expo/vector-icons (Ionicons) |

## Project Structure

```
book-player-2/
  app/                    # Screens (Expo Router file-based routing)
    _layout.tsx           # Root layout - wraps app in AudioProvider
    index.tsx             # Home screen - book library with sections
    player/[id].tsx       # Player screen - playback controls, seek, speed
    select-folder.tsx     # Folder source management
    analytics/
      index.tsx           # Analytics dashboard - summary, charts, book lists
      [id].tsx            # Per-book analytics detail
    +not-found.tsx        # 404 fallback
  services/
    database.ts           # SQLite schema, queries, and data access
    audioContext.tsx       # React Context for audio state + TrackPlayer
    playbackService.ts    # Background playback event handlers
    scanner.ts            # File import (SAF on Android, local copy on iOS)
  components/
    BookHistoryRow.tsx     # Shared book row component for analytics lists
  constants/
    theme.ts              # Color palette
    styles.ts             # Shared styles (container, header, coverImage)
  utils/
    format.ts             # Shared formatting (duration, time, date, daysBetween)
```

## Data Flow

```
User selects folder
  -> scanner.ts discovers audio files
  -> Inserts books + chapters into SQLite
  -> Home screen queries books + progress

User opens a book
  -> audioContext loads book from DB
  -> Builds TrackPlayer queue from chapters
  -> Restores saved position
  -> Starts progress save interval (5s)

Progress saves automatically
  -> Every 5 seconds while loaded
  -> On seek events
  -> On book unload / switch
  -> Listening time tracked and flushed to listening_sessions

Remote controls (lock screen, headphones)
  -> playbackService.ts handles background events
  -> audioContext.tsx handles foreground events via useTrackPlayerEvents
```

## Key Design Decisions

### Module-level Singleton Database
The database uses a module-level `let db` variable initialized on first access via `getDatabase()`. This avoids passing the database instance through props or context.

### stateRef Pattern
The `AudioProvider` keeps a `stateRef` that mirrors React state. This allows callbacks (intervals, event handlers) to read current state without stale closures, while still triggering re-renders through `setState`.

### Transition Guard
An `isTransitioningRef` flag blocks progress saves and playback status updates during book switches. This prevents race conditions where stale callbacks write to the wrong book's progress or trigger NullPointerExceptions on the native database.

### Platform-Specific File Handling
- **Android**: Uses Storage Access Framework (SAF) content:// URIs. Files are played directly from their original location (no copying).
- **iOS**: Copies audio files into the app's document directory during import. This ensures playback works even if the source location changes.
