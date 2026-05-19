import TrackPlayer, { Event } from "react-native-track-player";
import { SKIP_SECONDS } from "@/constants/playback";

// Single source of truth for remote control events (lock screen, headphones,
// notification). The foreground AudioContext intentionally does NOT also handle
// these — its usePlaybackState/useProgress hooks observe the resulting state.
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
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
