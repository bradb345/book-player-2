import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import TrackPlayer, {
  Capability,
  State,
  Event,
  useTrackPlayerEvents,
  usePlaybackState,
  useProgress,
  RepeatMode,
  Track,
} from "react-native-track-player";
import {
  Book,
  Chapter,
  BookHistory,
  getBookWithChapters,
  getProgress,
  updateProgress,
  updateChapterDuration,
  updateBookDuration,
  getOrCreateBookHistory,
  markBookHistoryCompleted,
  updateBookHistoryDuration,
  upsertListeningSession,
} from "./database";
import { getCachedSettings } from "./settings";
import { useSettings } from "./settingsContext";

interface AudioState {
  book: Book | null;
  chapters: Chapter[];
  currentChapterIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
  error: string | null;
}

interface AudioContextType {
  // State
  state: AudioState;
  // Actions
  loadBook: (bookId: number) => Promise<void>;
  togglePlayback: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
  seekRelative: (deltaMs: number) => Promise<void>;
  goToChapter: (chapterIndex: number, startPosition?: number) => Promise<void>;
  nextChapter: () => Promise<void>;
  previousChapter: () => Promise<void>;
  setPlaybackSpeed: (speed: number) => Promise<void>;
  stopAndUnload: () => Promise<void>;
}

const initialState: AudioState = {
  book: null,
  chapters: [],
  currentChapterIndex: 0,
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
  playbackSpeed: 1.0,
  error: null,
};

const AudioContext = createContext<AudioContextType | null>(null);

let isPlayerSetup = false;

// Full options object — passed to updateOptions both at setup and whenever the
// skip interval changes. RNTP's updateOptions replaces (not merges) options, so
// the capabilities must be included every time to avoid clobbering them.
function buildPlayerOptions(skipSeconds: number) {
  return {
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.JumpForward,
      Capability.JumpBackward,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    forwardJumpInterval: skipSeconds,
    backwardJumpInterval: skipSeconds,
    progressUpdateEventInterval: 1,
  };
}

async function setupPlayer() {
  if (isPlayerSetup) return;
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });
    await TrackPlayer.updateOptions(
      buildPlayerOptions(getCachedSettings().skipSeconds)
    );
    await TrackPlayer.setRepeatMode(RepeatMode.Off);
    isPlayerSetup = true;
  } catch (e) {
    // Player might already be set up (e.g., after hot reload)
    console.warn("TrackPlayer setup error (may be already initialized):", e);
    isPlayerSetup = true;
  }
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AudioState>(initialState);
  const chapterDurationsRef = useRef<Map<number, number>>(new Map());
  const isTransitioningRef = useRef(false);
  const bookHistoryRef = useRef<BookHistory | null>(null);
  const accumulatedListeningMsRef = useRef(0);
  const lastProgressTimestampRef = useRef<number | null>(null);
  const playerReadyRef = useRef(false);

  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Auto sleep timer handle; pauses playback when it fires.
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for callbacks to avoid stale closures
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Keep the lock-screen / notification jump buttons in sync with the
  // configured skip interval (setupPlayer may have run before settings loaded).
  useEffect(() => {
    if (!playerReadyRef.current) return;
    TrackPlayer.updateOptions(buildPlayerOptions(settings.skipSeconds)).catch(
      (e) => console.warn("Error updating jump intervals:", e)
    );
  }, [settings.skipSeconds]);

  // Auto sleep timer: when playback is running inside the configured clock
  // window, pause it after the configured duration. The timer (re)starts each
  // time playback resumes and is cleared on pause / unmount.
  useEffect(() => {
    const clearSleep = () => {
      if (sleepTimeoutRef.current) {
        clearTimeout(sleepTimeoutRef.current);
        sleepTimeoutRef.current = null;
      }
    };

    if (
      !state.isPlaying ||
      !settings.autoSleepEnabled ||
      settings.autoSleepDurationMin <= 0
    ) {
      clearSleep();
      return;
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const start = settings.autoSleepStartMin;
    const end = settings.autoSleepEndMin;
    // end <= start means the window wraps past midnight (e.g. 22:00–06:00).
    const inWindow =
      start === end
        ? true
        : start < end
          ? nowMin >= start && nowMin < end
          : nowMin >= start || nowMin < end;

    if (!inWindow) {
      clearSleep();
      return;
    }

    clearSleep();
    sleepTimeoutRef.current = setTimeout(
      () => {
        sleepTimeoutRef.current = null;
        TrackPlayer.pause().catch((e) =>
          console.warn("Error pausing for sleep timer:", e)
        );
        setState((prev) => ({ ...prev, isPlaying: false }));
      },
      settings.autoSleepDurationMin * 60 * 1000
    );

    return clearSleep;
  }, [
    state.isPlaying,
    settings.autoSleepEnabled,
    settings.autoSleepStartMin,
    settings.autoSleepEndMin,
    settings.autoSleepDurationMin,
  ]);

  // Setup player on mount
  useEffect(() => {
    setupPlayer().then(() => {
      playerReadyRef.current = true;
      // If settings finished loading before the player was ready, the
      // skipSeconds effect above would have bailed early — reapply now.
      TrackPlayer.updateOptions(
        buildPlayerOptions(settingsRef.current.skipSeconds)
      ).catch((e) => console.warn("Error applying jump intervals:", e));
    });
  }, []);

  // Playback state tracking via hook
  const playbackState = usePlaybackState();
  useEffect(() => {
    if (isTransitioningRef.current) return;

    const playing =
      playbackState.state === State.Playing ||
      playbackState.state === State.Buffering;

    setState((prev) => {
      if (prev.isPlaying === playing) return prev;
      return { ...prev, isPlaying: playing };
    });
  }, [playbackState.state]);

  // Track progress via useProgress hook (polls TrackPlayer every 1s)
  const progress = useProgress(1000);
  useEffect(() => {
    if (isTransitioningRef.current) return;

    const positionMs = Math.round(progress.position * 1000);
    const durationMs = Math.round(progress.duration * 1000);

    setState((prev) => {
      if (prev.positionMs === positionMs && prev.durationMs === durationMs) return prev;
      return { ...prev, positionMs, durationMs };
    });

    // Track chapter duration discovery
    const currentState = stateRef.current;
    if (durationMs > 0 && currentState.chapters[currentState.currentChapterIndex]) {
      const chapterId = currentState.chapters[currentState.currentChapterIndex].id;
      if (!chapterDurationsRef.current.has(chapterId)) {
        // Mark as pending immediately to prevent duplicate writes
        chapterDurationsRef.current.set(chapterId, durationMs);

        // Save this chapter's duration to DB, clear on failure so it retries
        updateChapterDuration(chapterId, durationMs).catch((e) => {
          chapterDurationsRef.current.delete(chapterId);
          console.warn("Error saving chapter duration:", e);
        });

        // Update book total duration with what we know so far
        if (currentState.book) {
          let totalDuration = 0;
          chapterDurationsRef.current.forEach((duration) => {
            totalDuration += duration;
          });
          for (const ch of currentState.chapters) {
            if (!chapterDurationsRef.current.has(ch.id) && ch.duration_ms > 0) {
              totalDuration += ch.duration_ms;
            }
          }
          updateBookDuration(currentState.book.id, totalDuration).catch((e) =>
            console.warn("Error updating book duration:", e)
          );
          if (bookHistoryRef.current) {
            updateBookHistoryDuration(bookHistoryRef.current.id, totalDuration).catch((e) =>
              console.warn("Error updating book history duration:", e)
            );
          }
        }
      }
    }
  }, [progress.position, progress.duration]);

  // Event: active track changed (chapter auto-advance)
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], (event) => {
    if (isTransitioningRef.current) return;

    const currentState = stateRef.current;
    if (event.index != null && event.index !== currentState.currentChapterIndex) {
      setState((prev) => ({
        ...prev,
        currentChapterIndex: event.index!,
        positionMs: 0,
      }));
    }
  });

  // Remote control events (lock screen, headphones, notification) are handled
  // exclusively by the registered PlaybackService (services/playbackService.ts).
  // Handling them here too made jump/skip events fire twice. The UI stays in
  // sync because usePlaybackState (above) and useProgress (below) observe the
  // resulting TrackPlayer state.

  // Event: queue ended (last chapter finished)
  useTrackPlayerEvents([Event.PlaybackQueueEnded], (event) => {
    if (isTransitioningRef.current) return;

    if (bookHistoryRef.current) {
      markBookHistoryCompleted(bookHistoryRef.current.id).catch((e) =>
        console.warn("Error marking book completed:", e)
      );
    }
  });

  // Progress saving interval + listening time tracking
  useEffect(() => {
    const saveProgress = async () => {
      if (isTransitioningRef.current) return;
      const { book, chapters, currentChapterIndex, isPlaying } = stateRef.current;
      if (!book || chapters.length === 0) return;

      // Get fresh position from TrackPlayer
      let positionMs = 0;
      try {
        const progress = await TrackPlayer.getProgress();
        positionMs = Math.round(progress.position * 1000);
      } catch {
        return;
      }

      if (positionMs === 0) return;

      const now = Date.now();

      // Track listening time when playing
      if (isPlaying && lastProgressTimestampRef.current !== null) {
        const elapsed = now - lastProgressTimestampRef.current;
        // Clamp to 10s max to handle backgrounding/sleep
        const clamped = Math.min(elapsed, 10000);
        accumulatedListeningMsRef.current += clamped;
      }
      lastProgressTimestampRef.current = isPlaying ? now : null;

      // Flush accumulated listening time
      if (accumulatedListeningMsRef.current > 0 && bookHistoryRef.current) {
        const toFlush = accumulatedListeningMsRef.current;
        accumulatedListeningMsRef.current = 0;
        try {
          await upsertListeningSession(bookHistoryRef.current.id, toFlush);
        } catch (e) {
          console.warn("Error saving listening session:", e);
        }
      }

      // Only save if we have a valid chapter and position
      const chapter = chapters[currentChapterIndex];
      if (chapter && (isPlaying || positionMs > 0)) {
        try {
          await updateProgress(book.id, chapter.id, positionMs);
        } catch (e) {
          console.warn("Error saving progress:", e);
        }
      }
    };

    const interval = setInterval(saveProgress, 5000);
    return () => clearInterval(interval);
  }, []);

  // Build track queue from chapters
  const buildQueue = useCallback((chapters: Chapter[], book: Book): Track[] => {
    return chapters.map((chapter) => ({
      id: String(chapter.id),
      url: chapter.file_path,
      title: chapter.title,
      artist: book.title,
      album: book.author || undefined,
      artwork: book.cover_path || undefined,
      duration: chapter.duration_ms > 0 ? chapter.duration_ms / 1000 : undefined,
    }));
  }, []);

  // Load a book
  const loadBook = useCallback(async (bookId: number) => {
    // If same book is already loaded, don't reload
    if (stateRef.current.book?.id === bookId && playerReadyRef.current) {
      // Check if there's actually a queue loaded
      const queue = await TrackPlayer.getQueue();
      if (queue.length > 0) return;
    }

    // Block progress saves during transition
    isTransitioningRef.current = true;

    // Save progress of the current book before switching
    const { book: prevBook, chapters: prevChapters, currentChapterIndex: prevIndex } = stateRef.current;
    if (prevBook && prevChapters.length > 0) {
      let prevPosition = 0;
      try {
        const progress = await TrackPlayer.getProgress();
        prevPosition = Math.round(progress.position * 1000);
      } catch { /* ignore */ }

      if (prevPosition > 0) {
        const prevChapter = prevChapters[prevIndex];
        if (prevChapter) {
          try {
            await updateProgress(prevBook.id, prevChapter.id, prevPosition);
          } catch (e) {
            console.warn("Error saving previous book progress:", e);
          }
        }
      }
    }

    // Reset player before changing state
    try {
      await TrackPlayer.reset();
    } catch { /* ignore if not initialized yet */ }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Ensure player is set up
    await setupPlayer();

    const bookData = await getBookWithChapters(bookId);
    if (!bookData) {
      isTransitioningRef.current = false;
      setState((prev) => ({ ...prev, isLoading: false, error: "Book not found" }));
      return;
    }

    // Load saved progress
    let chapterIndex = 0;
    let initialPosition = 0;
    const progress = await getProgress(bookId);
    if (progress && bookData.chapters.length > 0) {
      const foundIndex = bookData.chapters.findIndex((c) => c.id === progress.current_chapter_id);
      if (foundIndex >= 0) {
        chapterIndex = foundIndex;
        initialPosition = progress.position_ms;
      }
    }

    // Clear chapter durations for the new book
    chapterDurationsRef.current.clear();

    // Initialize book history for analytics
    try {
      bookHistoryRef.current = await getOrCreateBookHistory(bookId);
    } catch (e) {
      console.warn("Error creating book history:", e);
      bookHistoryRef.current = null;
    }
    accumulatedListeningMsRef.current = 0;
    lastProgressTimestampRef.current = null;

    // Newly opened books start at the user's default playback speed.
    const defaultSpeed = settingsRef.current.defaultPlaybackSpeed;

    setState((prev) => ({
      ...prev,
      book: bookData.book,
      chapters: bookData.chapters,
      currentChapterIndex: chapterIndex,
      positionMs: initialPosition,
      playbackSpeed: defaultSpeed,
      isLoading: false,
    }));

    isTransitioningRef.current = false;

    // Load the queue and seek to saved position
    if (bookData.chapters.length > 0) {
      try {
        const queue = buildQueue(bookData.chapters, bookData.book);
        await TrackPlayer.setQueue(queue);
        await TrackPlayer.skip(chapterIndex);
        if (initialPosition > 0) {
          await TrackPlayer.seekTo(initialPosition / 1000);
        }
        // Apply the default playback speed for this book
        await TrackPlayer.setRate(defaultSpeed);

        // Fetch initial track duration (progress events only fire while playing)
        try {
          const trackProgress = await TrackPlayer.getProgress();
          if (trackProgress.duration > 0) {
            setState((prev) => ({
              ...prev,
              durationMs: Math.round(trackProgress.duration * 1000),
            }));
          }
        } catch { /* ignore */ }
      } catch (e) {
        console.error("Error loading audio queue:", e);
        setState((prev) => ({
          ...prev,
          error: "Unable to play this audiobook. The file may not be accessible.\n\nTry re-importing the book.",
        }));
      }

      // Save progress immediately so the book moves to "In Progress"
      try {
        await updateProgress(bookData.book.id, bookData.chapters[chapterIndex].id, initialPosition);
      } catch (e) {
        console.warn("Error saving initial progress:", e);
      }
    }
  }, [buildQueue]);

  // Go to a specific chapter
  const goToChapter = useCallback(async (chapterIndex: number, startPosition: number = 0) => {
    const { chapters, isPlaying } = stateRef.current;
    if (chapterIndex < 0 || chapterIndex >= chapters.length) return;

    setState((prev) => ({
      ...prev,
      currentChapterIndex: chapterIndex,
      positionMs: startPosition,
    }));

    try {
      await TrackPlayer.skip(chapterIndex);
      if (startPosition > 0) {
        await TrackPlayer.seekTo(startPosition / 1000);
      }
      if (isPlaying) {
        await TrackPlayer.play();
      }
    } catch (e) {
      console.error("Error going to chapter:", e);
    }
  }, []);

  // Rewind a few seconds before resuming so you don't lose your place after
  // a pause. No-op when the setting is 0 or playback is at the very start.
  const applyAutoRewind = useCallback(async () => {
    const seconds = settingsRef.current.autoRewindSeconds;
    if (seconds <= 0) return;
    try {
      const { position } = await TrackPlayer.getProgress();
      const target = Math.max(0, position - seconds);
      if (target < position) {
        await TrackPlayer.seekTo(target);
        setState((prev) => ({ ...prev, positionMs: Math.round(target * 1000) }));
      }
    } catch (e) {
      console.warn("Error applying auto-rewind:", e);
    }
  }, []);

  // Toggle playback
  const togglePlayback = useCallback(async () => {
    try {
      const playerState = await TrackPlayer.getPlaybackState();
      if (playerState.state === State.Playing) {
        await TrackPlayer.pause();
        setState((prev) => ({ ...prev, isPlaying: false }));
      } else {
        await applyAutoRewind();
        await TrackPlayer.play();
        setState((prev) => ({ ...prev, isPlaying: true }));
      }
    } catch (e) {
      console.error("Error toggling playback:", e);
    }
  }, [applyAutoRewind]);

  // Play
  const play = useCallback(async () => {
    try {
      await applyAutoRewind();
      await TrackPlayer.play();
      setState((prev) => ({ ...prev, isPlaying: true }));
    } catch (e) {
      console.error("Error playing:", e);
    }
  }, [applyAutoRewind]);

  // Pause
  const pause = useCallback(async () => {
    try {
      await TrackPlayer.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
    } catch (e) {
      console.error("Error pausing:", e);
    }
  }, []);

  // Seek to position (positionMs in milliseconds)
  const seekTo = useCallback(async (positionMs: number) => {
    const { book, chapters, currentChapterIndex } = stateRef.current;
    if (!book) return;

    // Update state immediately so slider reflects the new position
    setState((prev) => ({ ...prev, positionMs }));

    try {
      await TrackPlayer.seekTo(positionMs / 1000);
    } catch (e) {
      console.error("Error seeking:", e);
      return;
    }

    // Save progress in background (don't let DB errors break seek)
    const chapter = chapters[currentChapterIndex];
    if (chapter) {
      updateProgress(book.id, chapter.id, positionMs).catch((e) =>
        console.warn("Error saving progress after seek:", e)
      );
    }
  }, []);

  // Seek relative (skip forward/back)
  const seekRelative = useCallback(async (deltaMs: number) => {
    const { positionMs, durationMs } = stateRef.current;
    const newPosition = Math.max(0, Math.min(durationMs, positionMs + deltaMs));
    await seekTo(newPosition);
  }, [seekTo]);

  // Next chapter
  const nextChapter = useCallback(async () => {
    const { currentChapterIndex, chapters } = stateRef.current;
    if (currentChapterIndex < chapters.length - 1) {
      await goToChapter(currentChapterIndex + 1, 0);
    }
  }, [goToChapter]);

  // Previous chapter
  const previousChapter = useCallback(async () => {
    const { currentChapterIndex } = stateRef.current;
    if (currentChapterIndex > 0) {
      await goToChapter(currentChapterIndex - 1, 0);
    }
  }, [goToChapter]);

  // Set playback speed
  const setPlaybackSpeed = useCallback(async (speed: number) => {
    setState((prev) => ({ ...prev, playbackSpeed: speed }));

    try {
      await TrackPlayer.setRate(speed);
    } catch (e) {
      console.error("Error setting playback rate:", e);
    }
  }, []);

  // Stop and unload
  const stopAndUnload = useCallback(async () => {
    // Save progress before unloading
    const { book, chapters, currentChapterIndex } = stateRef.current;
    if (book && chapters.length > 0) {
      let positionMs = 0;
      try {
        const progress = await TrackPlayer.getProgress();
        positionMs = Math.round(progress.position * 1000);
      } catch { /* ignore */ }

      if (positionMs > 0) {
        const chapter = chapters[currentChapterIndex];
        if (chapter) {
          await updateProgress(book.id, chapter.id, positionMs);
        }
      }
    }

    try {
      await TrackPlayer.reset();
    } catch (e) {
      console.warn("Error resetting player:", e);
    }

    setState(initialState);
    chapterDurationsRef.current.clear();
    bookHistoryRef.current = null;
    accumulatedListeningMsRef.current = 0;
    lastProgressTimestampRef.current = null;
  }, []);

  return (
    <AudioContext.Provider
      value={{
        state,
        loadBook,
        togglePlayback,
        play,
        pause,
        seekTo,
        seekRelative,
        goToChapter,
        nextChapter,
        previousChapter,
        setPlaybackSpeed,
        stopAndUnload,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }
  return context;
}
