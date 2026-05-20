import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import TrackPlayer from "react-native-track-player";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import { useAudio } from "@/services/audioContext";
import { useSettings } from "@/services/settingsContext";
import { getBookHistoryByBookId } from "@/services/database";
import { formatPlaybackTime, formatDuration } from "@/utils/format";
import { BookCover } from "@/components/BookCover";
import { NotFoundScreen } from "@/components/NotFoundScreen";

const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings } = useSettings();
  const skipSeconds = settings.skipSeconds;

  const {
    state,
    loadBook,
    togglePlayback,
    seekTo,
    seekRelative,
    nextChapter,
    previousChapter,
    goToChapter,
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
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [showChapters, setShowChapters] = useState(false);

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
    let dur = durationMs;
    if (dur <= 0) {
      try {
        const progress = await TrackPlayer.getProgress();
        dur = Math.round(progress.duration * 1000);
      } catch { /* ignore */ }
    }
    if (dur <= 0) {
      setIsSeeking(false);
      return;
    }
    const newPosition = Math.floor(value * dur);
    await seekTo(newPosition);
    setIsSeeking(false);
  };

  const handleSpeedChange = async (value: number) => {
    const speed = Math.round(value * 10) / 10;
    await setPlaybackSpeed(speed);
  };

  const currentChapter = chapters[currentChapterIndex];

  if (isInitialLoading) {
    return (
      <View style={[sharedStyles.container, sharedStyles.centered]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={colors.red} />
      </View>
    );
  }

  if (!book) {
    return <NotFoundScreen message="Book not found" />;
  }

  return (
    <View style={sharedStyles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerSubtitle}>NOW PLAYING</Text>
        </View>
        <Pressable
          style={styles.analyticsButton}
          onPress={async () => {
            if (!book) return;
            const history = await getBookHistoryByBookId(book.id);
            if (history) {
              router.push(`/analytics/${history.id}`);
            } else {
              router.push("/analytics");
            }
          }}
          hitSlop={8}
        >
          <Ionicons name="stats-chart" size={22} color={colors.white} />
        </Pressable>
      </View>

      {/* Book Cover */}
      <View style={styles.coverContainer}>
        <View style={styles.cover}>
          <BookCover coverPath={book.cover_path} iconSize={80} loading={isLoading} />
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
          <Pressable
            style={styles.chapterCountButton}
            onPress={() => setShowChapters(true)}
            hitSlop={8}
          >
            <Text style={styles.chapterCount}>
              Chapter {currentChapterIndex + 1} of {chapters.length}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.lightGrey} />
          </Pressable>
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
          value={isSeeking ? seekValue : (durationMs > 0 ? positionMs / durationMs : 0)}
          onSlidingStart={(value) => {
            setIsSeeking(true);
            setSeekValue(value);
          }}
          onValueChange={(value) => {
            if (isSeeking) setSeekValue(value);
          }}
          onSlidingComplete={handleSeek}
          minimumTrackTintColor={colors.red}
          maximumTrackTintColor={colors.mediumGrey}
          thumbTintColor={colors.white}
          disabled={isLoading}
        />
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>
            {formatPlaybackTime(isSeeking && durationMs > 0 ? Math.floor(seekValue * durationMs) : positionMs)}
          </Text>
          <Text style={styles.timeText}>{formatPlaybackTime(durationMs)}</Text>
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
          onPress={() => seekRelative(-skipSeconds * 1000)}
        >
          <View style={styles.skipButton}>
            <Ionicons name="play-back" size={32} color={colors.white} />
            <Text style={styles.skipText}>{skipSeconds}</Text>
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
          onPress={() => seekRelative(skipSeconds * 1000)}
        >
          <View style={styles.skipButton}>
            <Ionicons name="play-forward" size={32} color={colors.white} />
            <Text style={styles.skipText}>{skipSeconds}</Text>
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

      <Modal
        visible={showChapters}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowChapters(false)}
      >
        <SafeAreaView style={sharedStyles.container} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Chapters</Text>
            <Pressable
              onPress={() => setShowChapters(false)}
              hitSlop={16}
              style={styles.modalCloseButton}
            >
              <Ionicons name="close" size={26} color={colors.white} />
            </Pressable>
          </View>
          <FlatList
            data={chapters}
            keyExtractor={(item) => String(item.id)}
            initialScrollIndex={
              currentChapterIndex < chapters.length ? currentChapterIndex : 0
            }
            getItemLayout={(_, index) => ({
              length: 64,
              offset: 64 * index,
              index,
            })}
            renderItem={({ item, index }) => {
              const isCurrent = index === currentChapterIndex;
              return (
                <Pressable
                  style={[
                    styles.chapterRow,
                    isCurrent && styles.chapterRowActive,
                  ]}
                  onPress={async () => {
                    setShowChapters(false);
                    if (index !== currentChapterIndex) {
                      await goToChapter(index, 0);
                    }
                  }}
                >
                  <View style={styles.chapterRowLeft}>
                    {isCurrent ? (
                      <Ionicons
                        name={isPlaying ? "volume-high" : "pause"}
                        size={18}
                        color={colors.red}
                      />
                    ) : (
                      <Text style={styles.chapterNumber}>{index + 1}</Text>
                    )}
                  </View>
                  <View style={styles.chapterRowMain}>
                    <Text
                      style={[
                        styles.chapterRowTitle,
                        isCurrent && styles.chapterRowTitleActive,
                      ]}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    {item.duration_ms > 0 && (
                      <Text style={styles.chapterRowDuration}>
                        {formatDuration(item.duration_ms)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
  analyticsButton: {
    padding: 4,
    width: 36,
    alignItems: "center",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.mediumGrey,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.white,
  },
  modalCloseButton: {
    padding: 4,
  },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 64,
    paddingHorizontal: 20,
  },
  chapterRowActive: {
    backgroundColor: colors.mediumGrey,
  },
  chapterRowLeft: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterNumber: {
    fontSize: 14,
    color: colors.lightGrey,
    fontVariant: ["tabular-nums"],
  },
  chapterRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginLeft: 12,
    gap: 12,
  },
  chapterRowTitle: {
    flex: 1,
    fontSize: 15,
    color: colors.white,
  },
  chapterRowTitleActive: {
    color: colors.red,
    fontWeight: "600",
  },
  chapterRowDuration: {
    fontSize: 13,
    color: colors.lightGrey,
    fontVariant: ["tabular-nums"],
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
  chapterCountButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
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
