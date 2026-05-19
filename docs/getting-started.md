# Getting Started

## Prerequisites

- Node.js 18+
- Android Studio (for Android development) or Xcode (for iOS)
- A physical device is recommended for audio playback testing

> This app **cannot run in Expo Go** — it depends on the native
> `react-native-track-player` module and `expo-dev-client`, so it always needs
> a custom dev build (`npm run ios` / `npm run android`).

## Setup

```bash
# Install dependencies
npm install

# Build & run a dev client on a connected device/simulator
npm run android
npm run ios

# Start the Metro dev server for JS-only iteration (after a dev build exists)
npm start
```

## Development

The app uses [Expo Router](https://docs.expo.dev/router/introduction/) for file-based navigation. Screens live in the `app/` directory:

- `app/index.tsx` - Home screen (library)
- `app/player/[id].tsx` - Player (dynamic route by book ID)
- `app/select-folder.tsx` - Folder management
- `app/analytics/index.tsx` - Analytics dashboard
- `app/analytics/[id].tsx` - Per-book analytics

### Adding a New Screen

Create a new `.tsx` file in the `app/` directory. Expo Router automatically registers it as a route.

### Working with the Database

All database access goes through `services/database.ts`. Add new queries as exported async functions that call `getDatabase()` to get the singleton connection.

### Audio Playback

Use the `useAudio()` hook to access playback state and controls. The `AudioProvider` in `app/_layout.tsx` wraps the entire app.

```tsx
const { state, togglePlayback, seekTo } = useAudio();
const { isPlaying, positionMs, durationMs } = state;
```

## Project Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start Expo dev server |
| `npm run android` | Build and run on Android |
| `npm run ios` | Build and run on iOS |
| `npm run lint` | Run ESLint |

## Debugging

- Audio playback issues: errors are logged via `console.warn`/`console.error` from `services/audioContext.tsx`
- Database issues: The SQLite database is stored as `audiobooks.db` in the app's document directory
- Import issues: `services/scanner.ts` logs each imported book and reports failures with `console.error`
