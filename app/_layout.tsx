import { Stack } from "expo-router";
import { SettingsProvider } from "@/services/settingsContext";
import { AudioProvider } from "@/services/audioContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <AudioProvider>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          />
        </AudioProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
