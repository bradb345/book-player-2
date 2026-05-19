import TrackPlayer, { Event } from "react-native-track-player";
import { SKIP_SECONDS } from "@/constants/playback";

// Single source of truth for remote control events (lock screen, headphones,
// notification). The foreground AudioContext intentionally does NOT also handle
// these — its usePlaybackState/useProgress hooks observe the resulting state.
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  // skipToNext/skipToPrevious reject when there is no next/previous track
  // (start/end of queue). Swallow it so a lock-screen tap at the queue edge
  // doesn't surface as an unhandled promise rejection.
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // no next track — nothing to do
    }
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      await TrackPlayer.skipToPrevious();
    } catch {
      // no previous track — nothing to do
    }
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(position + SKIP_SECONDS);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - SKIP_SECONDS));
  });
}
