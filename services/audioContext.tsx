import React, { createContext, useContext, useState, useCallback, useRef } from "react";

interface AudioContextType {
  isPlaying: boolean;
  currentBookId: number | null;
  setPlaybackState: (isPlaying: boolean, bookId: number | null) => void;
  registerToggleCallback: (callback: (() => void) | null) => void;
  togglePlayback: () => void;
}

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBookId, setCurrentBookId] = useState<number | null>(null);
  const toggleCallbackRef = useRef<(() => void) | null>(null);

  const setPlaybackState = useCallback((playing: boolean, bookId: number | null) => {
    setIsPlaying(playing);
    setCurrentBookId(bookId);
  }, []);

  const registerToggleCallback = useCallback((callback: (() => void) | null) => {
    toggleCallbackRef.current = callback;
  }, []);

  const togglePlayback = useCallback(() => {
    if (toggleCallbackRef.current) {
      toggleCallbackRef.current();
    }
  }, []);

  return (
    <AudioContext.Provider
      value={{
        isPlaying,
        currentBookId,
        setPlaybackState,
        registerToggleCallback,
        togglePlayback,
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
