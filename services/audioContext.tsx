import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Audio, AVPlaybackStatus } from "expo-av";
import {
  Book,
  Chapter,
  BookHistory,
  getBookWithChapters,
  getProgress,
  updateProgress,
  updateBookDuration,
  getOrCreateBookHistory,
  markBookHistoryCompleted,
  updateBookHistoryDuration,
  upsertListeningSession,
} from "./database";

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

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AudioState>(initialState);
  const soundRef = useRef<Audio.Sound | null>(null);
  const chapterDurationsRef = useRef<Map<number, number>>(new Map());
  const isTransitioningRef = useRef(false);
  const bookHistoryRef = useRef<BookHistory | null>(null);
  const accumulatedListeningMsRef = useRef(0);
  const lastProgressTimestampRef = useRef<number | null>(null);

  // Refs for callbacks to avoid stale closures
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Configure audio session on mount
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

  // Progress saving interval + listening time tracking
  useEffect(() => {
    const saveProgress = async () => {
      if (isTransitioningRef.current) return;
      const { book, chapters, currentChapterIndex, positionMs, isPlaying } = stateRef.current;
      if (!book || chapters.length === 0 || positionMs === 0) return;

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

  // Playback status update handler
  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) {
        console.error("Playback error:", status.error);
        setState(prev => ({ ...prev, error: `Playback error: ${status.error}` }));
      }
      return;
    }

    // Ignore status updates during book transitions
    if (isTransitioningRef.current) return;

    const currentState = stateRef.current;

    setState(prev => ({
      ...prev,
      positionMs: status.positionMillis,
      durationMs: status.durationMillis || 0,
      isPlaying: status.isPlaying,
    }));

    // Track chapter duration
    if (status.durationMillis && status.durationMillis > 0 && currentState.chapters[currentState.currentChapterIndex]) {
      const chapterId = currentState.chapters[currentState.currentChapterIndex].id;
      if (!chapterDurationsRef.current.has(chapterId)) {
        chapterDurationsRef.current.set(chapterId, status.durationMillis);

        // Update database when all chapter durations are known
        if (currentState.book && chapterDurationsRef.current.size === currentState.chapters.length) {
          let totalDuration = 0;
          chapterDurationsRef.current.forEach((duration) => {
            totalDuration += duration;
          });
          updateBookDuration(currentState.book.id, totalDuration);
          // Also sync to book_history
          if (bookHistoryRef.current) {
            updateBookHistoryDuration(bookHistoryRef.current.id, totalDuration).catch((e) =>
              console.warn("Error updating book history duration:", e)
            );
          }
        }
      }
    }

    // Auto-advance to next chapter or mark complete
    if (status.didJustFinish && !status.isLooping) {
      const { chapters, currentChapterIndex } = currentState;
      if (currentChapterIndex < chapters.length - 1) {
        // Use setTimeout to avoid state update during render
        setTimeout(() => {
          goToChapter(currentChapterIndex + 1, 0);
        }, 0);
      } else if (bookHistoryRef.current) {
        // Last chapter finished — mark book as completed
        markBookHistoryCompleted(bookHistoryRef.current.id).catch((e) =>
          console.warn("Error marking book completed:", e)
        );
      }
    }
  }, []);

  // Load audio for current chapter
  const loadChapterAudio = useCallback(async (
    chapter: Chapter,
    initialPosition: number,
    speed: number,
    shouldAutoPlay: boolean
  ) => {
    // Unload previous sound
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.warn("Error unloading previous audio:", e);
      }
      soundRef.current = null;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      console.log("Loading audio from:", chapter.file_path);

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: chapter.file_path },
        {
          shouldPlay: shouldAutoPlay,
          positionMillis: initialPosition,
          rate: speed,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 500,
        },
        onPlaybackStatusUpdate
      );

      soundRef.current = newSound;
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (e) {
      console.error("Error loading audio:", e);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: "Unable to play this audiobook. The file may not be accessible.\n\nTry re-importing the book.",
      }));
    }
  }, [onPlaybackStatusUpdate]);

  // Load a book
  const loadBook = useCallback(async (bookId: number) => {
    // If same book is already loaded, don't reload
    if (stateRef.current.book?.id === bookId && soundRef.current) {
      return;
    }

    // Block progress saves during transition
    isTransitioningRef.current = true;

    // Save progress of the current book before switching
    const { book: prevBook, chapters: prevChapters, currentChapterIndex: prevIndex, positionMs: prevPosition } = stateRef.current;
    if (prevBook && prevChapters.length > 0 && prevPosition > 0) {
      const prevChapter = prevChapters[prevIndex];
      if (prevChapter) {
        try {
          await updateProgress(prevBook.id, prevChapter.id, prevPosition);
        } catch (e) {
          console.warn("Error saving previous book progress:", e);
        }
      }
    }

    // Unload previous audio before changing state
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.warn("Error unloading previous audio:", e);
      }
      soundRef.current = null;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const bookData = await getBookWithChapters(bookId);
    if (!bookData) {
      isTransitioningRef.current = false;
      setState(prev => ({ ...prev, isLoading: false, error: "Book not found" }));
      return;
    }

    // Load saved progress
    let chapterIndex = 0;
    let initialPosition = 0;
    const progress = await getProgress(bookId);
    if (progress && bookData.chapters.length > 0) {
      const foundIndex = bookData.chapters.findIndex(c => c.id === progress.current_chapter_id);
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

    setState(prev => ({
      ...prev,
      book: bookData.book,
      chapters: bookData.chapters,
      currentChapterIndex: chapterIndex,
      positionMs: initialPosition,
      isLoading: false,
    }));

    isTransitioningRef.current = false;

    // Load the chapter audio and save initial progress
    if (bookData.chapters.length > 0) {
      await loadChapterAudio(
        bookData.chapters[chapterIndex],
        initialPosition,
        stateRef.current.playbackSpeed,
        false // Don't auto-play on load
      );

      // Save progress immediately so the book moves to "In Progress"
      try {
        await updateProgress(bookData.book.id, bookData.chapters[chapterIndex].id, initialPosition);
      } catch (e) {
        console.warn("Error saving initial progress:", e);
      }
    }
  }, [loadChapterAudio]);

  // Go to a specific chapter
  const goToChapter = useCallback(async (chapterIndex: number, startPosition: number = 0) => {
    const { chapters, playbackSpeed, isPlaying } = stateRef.current;
    if (chapterIndex < 0 || chapterIndex >= chapters.length) return;

    const chapter = chapters[chapterIndex];
    setState(prev => ({
      ...prev,
      currentChapterIndex: chapterIndex,
      positionMs: startPosition,
    }));

    await loadChapterAudio(chapter, startPosition, playbackSpeed, isPlaying);
  }, [loadChapterAudio]);

  // Toggle playback
  const togglePlayback = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          await sound.pauseAsync();
        } else {
          await sound.playAsync();
        }
      }
    } catch (e) {
      console.error("Error toggling playback:", e);
    }
  }, []);

  // Play
  const play = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.playAsync();
    } catch (e) {
      console.error("Error playing:", e);
    }
  }, []);

  // Pause
  const pause = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.pauseAsync();
    } catch (e) {
      console.error("Error pausing:", e);
    }
  }, []);

  // Seek to position
  const seekTo = useCallback(async (positionMs: number) => {
    const sound = soundRef.current;
    const { book, chapters, currentChapterIndex } = stateRef.current;
    if (!sound || !book) return;

    try {
      await sound.setPositionAsync(positionMs);
      // Immediate save on seek
      const chapter = chapters[currentChapterIndex];
      if (chapter) {
        await updateProgress(book.id, chapter.id, positionMs);
      }
    } catch (e) {
      console.error("Error seeking:", e);
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
    setState(prev => ({ ...prev, playbackSpeed: speed }));

    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.setRateAsync(speed, true);
    } catch (e) {
      console.error("Error setting playback rate:", e);
    }
  }, []);

  // Stop and unload
  const stopAndUnload = useCallback(async () => {
    // Save progress before unloading
    const { book, chapters, currentChapterIndex, positionMs } = stateRef.current;
    if (book && chapters.length > 0 && positionMs > 0) {
      const chapter = chapters[currentChapterIndex];
      if (chapter) {
        await updateProgress(book.id, chapter.id, positionMs);
      }
    }

    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.warn("Error unloading audio:", e);
      }
      soundRef.current = null;
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
