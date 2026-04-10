# Getting Started

## Prerequisites

- Node.js 18+
- Expo CLI (`npx expo`)
- Android Studio (for Android development) or Xcode (for iOS)
- A physical device is recommended for audio playback testing

## Setup

```bash
# Install dependencies
npm install

# Start the dev server
npm start

# Run on a specific platform
npm run android
npm run ios
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
| `npm run reset-project` | Reset to clean project state |

## Debugging

- Audio playback issues: Check the console for `[AudioContext]` and `[PlaybackService]` log prefixes
- Database issues: The SQLite database is stored as `audiobooks.db` in the app's document directory
- Import issues: Scanner logs each step with `console.log` and `console.error`
