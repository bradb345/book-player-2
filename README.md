# Book Player 2

A React Native audiobook player built with Expo. It scans folders of audio
files into a library, plays them with background/lock-screen controls, tracks
listening progress per chapter, and surfaces listening analytics.

- **Android**: reads audio directly from Storage Access Framework (`content://`) URIs.
- **iOS**: copies selected audio into app storage for reliable playback.

## Features

### Library
- Add one or more source folders; books are grouped by subdirectory, loose
  files become single-chapter books
- Auto-detects cover art from common filenames (cover, folder, front, album,
  artwork) and embedded chapter metadata
- "In Progress" and "Not Started" sections sorted by recency / title
- Library sync on focus and pull-to-refresh: imports new books, reconciles
  chapter changes, hides missing books without losing progress
- Long-press a book to edit title, reset progress, or remove

### Player
- Full-screen player with cover art, chapter title, and seek slider
- Play/pause, previous/next chapter, configurable skip forward/back
- Variable playback speed (0.5x–3.0x)
- Chapter selection modal to jump anywhere in the book
- Background playback with lock-screen and headphone remote controls
- Progress auto-saves every 5s and on seek; listening time tracked per session

### Notes
- Capture timestamped notes against the currently playing chapter
- List and delete notes per book

### Cover art search
- Search DuckDuckGo image results pre-filled with title/author and pick a new
  cover when the embedded/file-based art isn't right

### Analytics
- Dashboard with books started, books completed, and total listening time
- All Time / This Year / This Month filters
- Bar chart of completions per month
- Per-book detail screen with start date, status, time listened, and
  completion stats

### Settings
- Skip interval, auto-rewind on resume, default playback speed
- Auto sleep timer with nightly active window and pause-after duration
- Quick links to report bugs or suggest features on GitHub

## Requirements

This app **cannot run in Expo Go**. It depends on `react-native-track-player`
(a native module) and `expo-dev-client`, so it always needs a custom dev build.

- Node.js 18+
- Xcode (iOS) and/or Android Studio + SDK (Android)
- A physical device is recommended for audio playback testing

## Getting started

```bash
npm install

# Build & run a dev client on a connected device/simulator
npm run ios
npm run android

# Start the Metro dev server for JS-only iteration (after a dev build exists)
npm start
```

`ios/` and `android/` are gitignored prebuild artifacts regenerated from
`app.json` — don't hand-edit them.

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the Expo dev server (dev client) |
| `npm run ios` | Build and run on iOS |
| `npm run android` | Build and run on Android |
| `npm run lint` | Run ESLint |

EAS build/submit profiles live in [`eas.json`](./eas.json) for producing
standalone installs (Android APK, iOS release).

## Documentation

See [`docs/`](./docs) for architecture, screens, services, and the database
schema. Start with [`docs/architecture.md`](./docs/architecture.md).
