import { useState } from "react";
import { View, Text, StyleSheet, Pressable, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";

export default function HomeScreen() {
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "list" ? "grid" : "list"));
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5}]}>
        <Text style={styles.headerTitle}>Audiobooks</Text>
        <View style={styles.headerIcons}>
          <Pressable
            style={styles.iconButton}
            onPress={toggleViewMode}
            hitSlop={8}
          >
            <Ionicons
              name={viewMode === "list" ? "grid-outline" : "list-outline"}
              size={24}
              color={colors.white}
            />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/select-folder")}
            hitSlop={8}
          >
            <Ionicons name="folder-outline" size={24} color={colors.white} />
          </Pressable>
          <Pressable style={styles.iconButton} hitSlop={8}>
            <Ionicons name="settings-outline" size={24} color={colors.white} />
          </Pressable>
        </View>
      </View>

      {/* Content Area */}
      <View style={styles.content}>
        <Text style={styles.emptyText}>No audiobooks yet</Text>
        <Text style={styles.emptySubtext}>
          Tap the + button to add a folder
        </Text>
      </View>

      {/* Add Folder Button */}
      <Pressable
        style={styles.addButton}
        onPress={() => router.push("/select-folder")}
      >
        <Ionicons name="add" size={32} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGrey,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.white,
  },
  headerIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    color: colors.white,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.lightGrey,
  },
  addButton: {
    position: "absolute",
    bottom: 32,
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.red,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
});
