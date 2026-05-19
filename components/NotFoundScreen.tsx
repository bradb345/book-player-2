import { View, Text, StyleSheet, Pressable, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";

/**
 * Centered fallback shown when a routed entity (book, history) can't be found.
 */
export function NotFoundScreen({ message }: { message: string }) {
  const router = useRouter();
  return (
    <View style={[sharedStyles.container, sharedStyles.centered]}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: 16,
    color: colors.lightGrey,
    marginBottom: 16,
  },
  backButton: {
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
});
