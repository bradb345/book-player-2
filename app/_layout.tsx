import { Stack } from "expo-router";
import { AudioProvider } from "@/services/audioContext";

export default function RootLayout() {
  return (
    <AudioProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </AudioProvider>
  );
}
