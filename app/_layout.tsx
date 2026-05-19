import { Stack } from "expo-router";
import { SettingsProvider } from "@/services/settingsContext";
import { AudioProvider } from "@/services/audioContext";

export default function RootLayout() {
  return (
    <SettingsProvider>
      <AudioProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </AudioProvider>
    </SettingsProvider>
  );
}
