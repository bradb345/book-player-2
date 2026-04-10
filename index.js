import "expo-router/entry";
import TrackPlayer from "react-native-track-player";
import { PlaybackService } from "./services/playbackService";

TrackPlayer.registerPlaybackService(() => PlaybackService);
