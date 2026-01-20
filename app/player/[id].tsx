import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { colors } from "@/constants/theme";
import { useAudio } from "@/services/audioContext";

const SKIP_SECONDS = 30;
const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const {
    state,
    loadBook,
    togglePlayback,
    seekTo,
    seekRelative,
    nextChapter,
    previousChapter,
    setPlaybackSpeed,
  } = useAudio();

  const {
    book,
    chapters,
    currentChapterIndex,
    isPlaying,
    isLoading,
    positionMs,
    durationMs,
    playbackSpeed,
    error,
  } = state;

  const [showSpeedSlider, setShowSpeedSlider] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Load book on mount
  useEffect(() => {
    if (!id) return;

    const load = async () => {
      await loadBook(parseInt(id));
      setIsInitialLoading(false);
    };
    load();
  }, [id, loadBook]);

  const handleSeek = async (value: number) => {
    if (durationMs <= 0) return;
    const newPosition = Math.floor(value * durationMs);
    await seekTo(newPosition);
  };

  const handleSpeedChange = async (value: number) => {
    const speed = Math.round(value * 10) / 10;
    await setPlaybackSpeed(speed);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const currentChapter = chapters[currentChapterIndex];

  if (isInitialLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={colors.red} />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.errorText}>Book not found</Text>
        <Pressable style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-down" size={28} color={colors.white} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerSubtitle}>NOW PLAYING</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Book Cover */}
      <View style={styles.coverContainer}>
        <View style={styles.cover}>
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.lightGrey} />
          ) : book.cover_path ? (
            <Image source={{ uri: book.cover_path }} style={styles.coverImage} />
          ) : (
            <Ionicons name="book" size={80} color={colors.lightGrey} />
          )}
        </View>
      </View>

      {/* Book Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.bookTitle} numberOfLines={2}>
          {book.title}
        </Text>
        {currentChapter && (
          <Text style={styles.chapterTitle} numberOfLines={1}>
            {currentChapter.title}
          </Text>
        )}
        {chapters.length > 1 && (
          <Text style={styles.chapterCount}>
            Chapter {currentChapterIndex + 1} of {chapters.length}
          </Text>
        )}
      </View>

      {/* Error Message */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="warning" size={20} color={colors.red} />
          <Text style={styles.errorMessage}>{error}</Text>
        </View>
      )}

      {/* Progress Slider */}
      <View style={styles.progressContainer}>
        <Slider
          style={styles.progressSlider}
          minimumValue={0}
          maximumValue={1}
          value={durationMs > 0 ? positionMs / durationMs : 0}
          onSlidingComplete={handleSeek}
          minimumTrackTintColor={colors.red}
          maximumTrackTintColor={colors.mediumGrey}
          thumbTintColor={colors.white}
          disabled={isLoading}
        />
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      {/* Playback Controls */}
      <View style={styles.controlsContainer}>
        <Pressable
          style={styles.controlButton}
          onPress={previousChapter}
          disabled={currentChapterIndex === 0}
        >
          <Ionicons
            name="play-skip-back"
            size={32}
            color={currentChapterIndex === 0 ? colors.mediumGrey : colors.white}
          />
        </Pressable>

        <Pressable
          style={styles.controlButton}
          onPress={() => seekRelative(-SKIP_SECONDS * 1000)}
        >
          <View style={styles.skipButton}>
            <Ionicons name="play-back" size={32} color={colors.white} />
            <Text style={styles.skipText}>{SKIP_SECONDS}</Text>
          </View>
        </Pressable>

        <Pressable
          style={[styles.playButton, isLoading && styles.playButtonDisabled]}
          onPress={togglePlayback}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={40}
              color={colors.white}
              style={!isPlaying && styles.playIcon}
            />
          )}
        </Pressable>

        <Pressable
          style={styles.controlButton}
          onPress={() => seekRelative(SKIP_SECONDS * 1000)}
        >
          <View style={styles.skipButton}>
            <Ionicons name="play-forward" size={32} color={colors.white} />
            <Text style={styles.skipText}>{SKIP_SECONDS}</Text>
          </View>
        </Pressable>

        <Pressable
          style={styles.controlButton}
          onPress={nextChapter}
          disabled={currentChapterIndex === chapters.length - 1}
        >
          <Ionicons
            name="play-skip-forward"
            size={32}
            color={
              currentChapterIndex === chapters.length - 1
                ? colors.mediumGrey
                : colors.white
            }
          />
        </Pressable>
      </View>

      {/* Speed Control */}
      <View style={[styles.speedContainer, { paddingBottom: insets.bottom + 20 }]}>
        <Pressable
          style={styles.speedButton}
          onPress={() => setShowSpeedSlider(!showSpeedSlider)}
        >
          <Ionicons name="speedometer-outline" size={20} color={colors.white} />
          <Text style={styles.speedButtonText}>{playbackSpeed.toFixed(1)}x</Text>
        </Pressable>

        {showSpeedSlider && (
          <View style={styles.speedSliderContainer}>
            <Text style={styles.speedLabel}>{MIN_SPEED}x</Text>
            <Slider
              style={styles.speedSlider}
              minimumValue={MIN_SPEED}
              maximumValue={MAX_SPEED}
              value={playbackSpeed}
              onValueChange={handleSpeedChange}
              minimumTrackTintColor={colors.red}
              maximumTrackTintColor={colors.mediumGrey}
              thumbTintColor={colors.white}
              step={0.1}
            />
            <Text style={styles.speedLabel}>{MAX_SPEED}x</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGrey,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: colors.lightGrey,
    marginBottom: 16,
  },
  backButtonLarge: {
    backgroundColor: colors.mediumGrey,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.lightGrey,
    letterSpacing: 1,
  },
  headerSpacer: {
    width: 36,
  },
  coverContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  cover: {
    width: "100%",
    maxWidth: 280,
    aspectRatio: 1,
    backgroundColor: colors.mediumGrey,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    overflow: "hidden",
  },
  coverImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  infoContainer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: "center",
  },
  bookTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: colors.white,
    textAlign: "center",
    marginBottom: 4,
  },
  chapterTitle: {
    fontSize: 16,
    color: colors.lightGrey,
    textAlign: "center",
    marginBottom: 4,
  },
  chapterCount: {
    fontSize: 14,
    color: colors.lightGrey,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    marginHorizontal: 24,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorMessage: {
    flex: 1,
    fontSize: 13,
    color: colors.lightGrey,
  },
  progressContainer: {
    paddingHorizontal: 24,
  },
  progressSlider: {
    width: "100%",
    height: 40,
  },
  timeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -8,
  },
  timeText: {
    fontSize: 12,
    color: colors.lightGrey,
  },
  controlsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 20,
    gap: 16,
  },
  controlButton: {
    padding: 8,
  },
  skipButton: {
    alignItems: "center",
  },
  skipText: {
    fontSize: 10,
    color: colors.lightGrey,
    marginTop: 2,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.red,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 8,
  },
  playButtonDisabled: {
    opacity: 0.6,
  },
  playIcon: {
    marginLeft: 4,
  },
  speedContainer: {
    paddingHorizontal: 24,
    alignItems: "center",
  },
  speedButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
  },
  speedButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.white,
  },
  speedSliderContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    width: "100%",
    gap: 8,
  },
  speedSlider: {
    flex: 1,
    height: 40,
  },
  speedLabel: {
    fontSize: 12,
    color: colors.lightGrey,
    minWidth: 30,
    textAlign: "center",
  },
});
