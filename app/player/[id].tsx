import { useState, useEffect, useCallback, useRef } from "react";
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
import { Audio, AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { colors } from "@/constants/theme";
import {
  getBookWithChapters,
  Book,
  Chapter,
  getProgress,
  updateProgress,
  updateBookDuration,
} from "@/services/database";
import { useAudio } from "@/services/audioContext";

const SKIP_SECONDS = 30;
const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setPlaybackState, registerToggleCallback } = useAudio();

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showSpeedSlider, setShowSpeedSlider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialPositionRef = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const chapterDurationsRef = useRef<Map<number, number>>(new Map());

  // Refs to avoid stale closures in callbacks
  const bookRef = useRef<Book | null>(null);
  const chaptersRef = useRef<Chapter[]>([]);
  const currentChapterIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const positionMsRef = useRef(0);

  // Load book data
  useEffect(() => {
    const loadBook = async () => {
      if (!id) return;

      const bookData = await getBookWithChapters(parseInt(id));
      if (bookData) {
        setBook(bookData.book);
        setChapters(bookData.chapters);

        // Load saved progress
        const progress = await getProgress(parseInt(id));
        if (progress && bookData.chapters.length > 0) {
          const chapterIndex = bookData.chapters.findIndex(
            (c) => c.id === progress.current_chapter_id
          );
          if (chapterIndex >= 0) {
            setCurrentChapterIndex(chapterIndex);
            initialPositionRef.current = progress.position_ms;
            setPositionMs(progress.position_ms);
          }
        }
      }
      setIsLoading(false);
    };

    loadBook();
  }, [id]);

  // Configure audio session
  useEffect(() => {
    const configureAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });
      } catch (e) {
        console.error("Error configuring audio:", e);
      }
    };
    configureAudio();
  }, []);

  // Sync playback state with global audio context
  useEffect(() => {
    const bookId = book?.id ?? null;
    setPlaybackState(isPlaying, bookId);
  }, [isPlaying, book, setPlaybackState]);

  // Keep refs in sync with state to avoid stale closures in audio callback
  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    currentChapterIndexRef.current = currentChapterIndex;
  }, [currentChapterIndex]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    positionMsRef.current = positionMs;
  }, [positionMs]);

  // Use refs in callback to always access latest values
  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) {
        console.error("Playback error:", status.error);
        setError(`Playback error: ${status.error}`);
      }
      return;
    }

    setPositionMs(status.positionMillis);
    setDurationMs(status.durationMillis || 0);
    setIsPlaying(status.isPlaying);

    const currentBook = bookRef.current;
    const currentChapters = chaptersRef.current;
    const chapterIndex = currentChapterIndexRef.current;

    // Track chapter duration
    if (status.durationMillis && status.durationMillis > 0 && currentChapters[chapterIndex]) {
      const chapterId = currentChapters[chapterIndex].id;
      if (!chapterDurationsRef.current.has(chapterId)) {
        chapterDurationsRef.current.set(chapterId, status.durationMillis);

        // Only update database when all chapter durations are known
        // This avoids multiple writes as user plays through chapters
        if (currentBook && chapterDurationsRef.current.size === currentChapters.length) {
          let totalDuration = 0;
          chapterDurationsRef.current.forEach((duration) => {
            totalDuration += duration;
          });
          updateBookDuration(currentBook.id, totalDuration);
        }
      }
    }

    // Auto-advance to next chapter
    if (status.didJustFinish && !status.isLooping) {
      if (chapterIndex < currentChapters.length - 1) {
        initialPositionRef.current = 0;
        setCurrentChapterIndex((prev) => prev + 1);
      }
    }
  }, []);

  // Load audio when chapter changes
  useEffect(() => {
    if (chapters.length === 0 || isLoading) return;

    const loadAudio = async () => {
      setIsLoadingAudio(true);
      setError(null);

      // Unload previous sound
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch (e) {
          // Log but don't block on unload errors (e.g., already unloaded)
          console.warn("Error unloading previous audio:", e);
        }
        soundRef.current = null;
        setSound(null);
      }

      const chapter = chapters[currentChapterIndex];
      if (!chapter) {
        setIsLoadingAudio(false);
        return;
      }

      try {
        console.log("Loading audio from:", chapter.file_path);

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: chapter.file_path },
          {
            shouldPlay: false,
            positionMillis: initialPositionRef.current,
            rate: playbackSpeed,
            shouldCorrectPitch: true,
            progressUpdateIntervalMillis: 500,
          },
          onPlaybackStatusUpdate
        );

        soundRef.current = newSound;
        setSound(newSound);
        initialPositionRef.current = 0; // Reset for future chapter changes
      } catch (e) {
        console.error("Error loading audio:", e);
        setError(
          "Unable to play this audiobook. The file may not be accessible.\n\nTry re-importing the book."
        );
      } finally {
        setIsLoadingAudio(false);
      }
    };

    loadAudio();

    return () => {
      if (soundRef.current) {
        // Fire-and-forget with error handling to avoid unhandled promise rejection
        soundRef.current.unloadAsync().catch((e) => {
          console.warn("Error unloading audio during cleanup:", e);
        });
        soundRef.current = null;
      }
    };
  }, [chapters, currentChapterIndex, isLoading]);

  // Update playback speed when it changes
  useEffect(() => {
    if (!sound) return;

    const updateRate = async () => {
      try {
        await sound.setRateAsync(playbackSpeed, true);
      } catch (e) {
        console.error("Error setting playback rate:", e);
        // Query current status to get actual rate and revert UI
        try {
          const status = await sound.getStatusAsync();
          if (status.isLoaded && status.rate !== playbackSpeed) {
            setPlaybackSpeed(status.rate);
            Alert.alert(
              "Speed Change Failed",
              "This audio format may not support the selected playback speed."
            );
          }
        } catch {
          // If we can't get status, just reset to 1.0x
          setPlaybackSpeed(1.0);
        }
      }
    };

    updateRate();
  }, [playbackSpeed, sound]);

  // Progress Saving Strategy:
  // - Saves current chapter ID + position within that chapter (not cumulative book position)
  // - Periodic save: every 5 seconds during playback
  // - Immediate save: when user seeks to a new position
  // - Final save: when component unmounts (using refs for latest values)
  // The home screen calculates cumulative progress from chapter durations when displaying.

  // Periodic progress save
  useEffect(() => {
    if (!book || chapters.length === 0) return;

    const saveProgress = async () => {
      const chapter = chapters[currentChapterIndex];
      if (chapter && positionMs > 0) {
        await updateProgress(book.id, chapter.id, positionMs);
      }
    };

    const interval = setInterval(saveProgress, 5000);
    return () => clearInterval(interval);
  }, [book, chapters, currentChapterIndex, positionMs]);

  // Save progress and duration on unmount (uses refs to capture latest values)
  useEffect(() => {
    return () => {
      const currentBook = bookRef.current;
      const currentChapters = chaptersRef.current;
      const chapterIndex = currentChapterIndexRef.current;
      const position = positionMsRef.current;

      if (currentBook && currentChapters.length > 0) {
        // Save playback position
        if (position > 0) {
          const chapter = currentChapters[chapterIndex];
          if (chapter) {
            updateProgress(currentBook.id, chapter.id, position);
          }
        }

        // Save discovered chapter durations if we have any
        if (chapterDurationsRef.current.size > 0) {
          let totalDuration = 0;
          chapterDurationsRef.current.forEach((duration) => {
            totalDuration += duration;
          });
          updateBookDuration(currentBook.id, totalDuration);
        }
      }
    };
  }, []);

  // Use refs for stable callback that doesn't change on every render
  const handlePlayPause = useCallback(async () => {
    const currentSound = soundRef.current;
    if (!currentSound) return;

    try {
      if (isPlayingRef.current) {
        await currentSound.pauseAsync();
      } else {
        await currentSound.playAsync();
      }
    } catch (e) {
      console.error("Error toggling playback:", e);
    }
  }, []);

  // Register toggle callback for global control (stable, only runs once)
  useEffect(() => {
    registerToggleCallback(handlePlayPause);
    return () => {
      registerToggleCallback(null);
      setPlaybackState(false, null);
    };
  }, [handlePlayPause, registerToggleCallback, setPlaybackState]);

  const handleSkipBack = async () => {
    if (!sound) return;
    try {
      const newPosition = Math.max(0, positionMs - SKIP_SECONDS * 1000);
      await sound.setPositionAsync(newPosition);
    } catch (e) {
      console.error("Error skipping back:", e);
    }
  };

  const handleSkipForward = async () => {
    if (!sound) return;
    try {
      const newPosition = Math.min(durationMs, positionMs + SKIP_SECONDS * 1000);
      await sound.setPositionAsync(newPosition);
    } catch (e) {
      console.error("Error skipping forward:", e);
    }
  };

  const handlePreviousChapter = () => {
    if (currentChapterIndex > 0) {
      initialPositionRef.current = 0;
      setPositionMs(0);
      setCurrentChapterIndex(currentChapterIndex - 1);
    }
  };

  const handleNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      initialPositionRef.current = 0;
      setPositionMs(0);
      setCurrentChapterIndex(currentChapterIndex + 1);
    }
  };

  const handleSeek = async (value: number) => {
    if (!sound || !book || chapters.length === 0) return;
    try {
      const newPosition = Math.floor(value * durationMs);
      await sound.setPositionAsync(newPosition);

      // Immediate save on seek (see Progress Saving Strategy above)
      const chapter = chapters[currentChapterIndex];
      if (chapter) {
        await updateProgress(book.id, chapter.id, newPosition);
      }
    } catch (e) {
      console.error("Error seeking:", e);
    }
  };

  const handleSpeedChange = (value: number) => {
    const speed = Math.round(value * 10) / 10;
    setPlaybackSpeed(speed);
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

  if (isLoading) {
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
          {isLoadingAudio ? (
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
          disabled={!sound || isLoadingAudio}
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
          onPress={handlePreviousChapter}
          disabled={currentChapterIndex === 0}
        >
          <Ionicons
            name="play-skip-back"
            size={32}
            color={currentChapterIndex === 0 ? colors.mediumGrey : colors.white}
          />
        </Pressable>

        <Pressable style={styles.controlButton} onPress={handleSkipBack}>
          <View style={styles.skipButton}>
            <Ionicons name="play-back" size={32} color={colors.white} />
            <Text style={styles.skipText}>{SKIP_SECONDS}</Text>
          </View>
        </Pressable>

        <Pressable
          style={[styles.playButton, (!sound || isLoadingAudio) && styles.playButtonDisabled]}
          onPress={handlePlayPause}
          disabled={!sound || isLoadingAudio}
        >
          {isLoadingAudio ? (
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

        <Pressable style={styles.controlButton} onPress={handleSkipForward}>
          <View style={styles.skipButton}>
            <Ionicons name="play-forward" size={32} color={colors.white} />
            <Text style={styles.skipText}>{SKIP_SECONDS}</Text>
          </View>
        </Pressable>

        <Pressable
          style={styles.controlButton}
          onPress={handleNextChapter}
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
