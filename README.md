# Book Player 2

A React Native audiobook player built with Expo. It scans folders of audio
files into a library, plays them with background/lock-screen controls, tracks
listening progress per chapter, and surfaces listening analytics.

- **Android**: reads audio directly from Storage Access Framework (`content://`) URIs.
- **iOS**: copies selected audio into app storage for reliable playback.

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

## Documentation

See [`docs/`](./docs) for architecture, screens, services, and the database
schema. Start with [`docs/architecture.md`](./docs/architecture.md).
