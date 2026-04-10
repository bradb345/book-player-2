import TrackPlayer, { Event } from "react-native-track-player";

export async function PlaybackService() {
  console.log('[PlaybackService] registering event listeners');
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    console.log('[PlaybackService] RemotePlay received');
    TrackPlayer.play();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    console.log('[PlaybackService] RemotePause received');
    TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(position + 30);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - 30));
  });
}
