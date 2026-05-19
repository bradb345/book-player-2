import TrackPlayer, { Event } from "react-native-track-player";
import { getSkipSeconds, getAutoRewindSeconds } from "@/services/settings";

// Single source of truth for remote control events (lock screen, headphones,
// notification). The foreground AudioContext intentionally does NOT also handle
// these — its usePlaybackState/useProgress hooks observe the resulting state.
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    // Apply auto-rewind so resuming from the lock screen / headphones behaves
    // the same as tapping the in-app play button.
    const rewind = await getAutoRewindSeconds();
    if (rewind > 0) {
      try {
        const { position } = await TrackPlayer.getProgress();
        const target = Math.max(0, position - rewind);
        if (target < position) await TrackPlayer.seekTo(target);
      } catch { /* fall through to play */ }
    }
    await TrackPlayer.play();
  });
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
    const skip = await getSkipSeconds();
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(position + skip);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    const skip = await getSkipSeconds();
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - skip));
  });
}
