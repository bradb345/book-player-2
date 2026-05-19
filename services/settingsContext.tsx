import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSetting,
} from "./settings";

interface SettingsContextType {
  settings: AppSettings;
  // True once the persisted settings have been read from disk.
  ready: boolean;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  // Guards against a hydration overwrite: if the user taps a control before
  // loadSettings resolves, the loaded snapshot would otherwise revert their
  // change (saveSetting already merged it into the module cache).
  const userTouchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((loaded) => {
      if (cancelled) return;
      if (!userTouchedRef.current) setSettings(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      userTouchedRef.current = true;
      // Optimistic: reflect immediately, then persist.
      setSettings((prev) => ({ ...prev, [key]: value }));
      try {
        await saveSetting(key, value);
      } catch (e) {
        console.warn(`Error saving setting "${String(key)}":`, e);
      }
    },
    []
  );

  return (
    <SettingsContext.Provider value={{ settings, ready, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
