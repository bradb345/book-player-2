import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { pickAudiobooksFolder, scanAndImportFolder } from "@/services/scanner";
import {
  getAllFolderSources,
  addFolderSource,
  removeFolderSource,
  folderSourceExists,
  FolderSource,
} from "@/services/database";

export default function SelectFolderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [folderSources, setFolderSources] = useState<FolderSource[]>([]);

  const loadFolderSources = useCallback(async () => {
    const sources = await getAllFolderSources();
    setFolderSources(sources);
  }, []);

  useEffect(() => {
    loadFolderSources();
  }, [loadFolderSources]);

  const handleAddFolder = async () => {
    setIsLoading(true);
    setStatus("Select a folder...");

    try {
      const pickResult = await pickAudiobooksFolder();

      if (!pickResult) {
        setStatus(null);
        setIsLoading(false);
        return;
      }

      // Check if folder is already added
      const exists = await folderSourceExists(pickResult.folderUri);
      if (exists) {
        setStatus("This folder is already added");
        setIsLoading(false);
        return;
      }

      // Add folder source to database
      await addFolderSource(pickResult.folderUri, pickResult.folderName);
      await loadFolderSources();

      // Scan the folder for audiobooks
      setIsScanning(true);
      setStatus(`Scanning "${pickResult.folderName}" for audiobooks...`);
      const result = await scanAndImportFolder(pickResult.folderUri);

      setStatus(result.message);
      setIsScanning(false);
      setIsLoading(false);
    } catch (error) {
      setStatus(`Error: ${error}`);
      setIsScanning(false);
      setIsLoading(false);
    }
  };

  const handleRemoveFolder = (folder: FolderSource) => {
    Alert.alert(
      "Remove Folder",
      `Remove "${folder.name}" from your sources? This won't delete any imported books.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeFolderSource(folder.id);
            await loadFolderSources();
          },
        },
      ]
    );
  };

  const handleRescanFolder = async (folder: FolderSource) => {
    setIsScanning(true);
    setStatus(`Scanning "${folder.name}" for new audiobooks...`);

    try {
      const result = await scanAndImportFolder(folder.uri);
      setStatus(result.message);
    } catch (error) {
      setStatus(`Error: ${error}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescanAll = async () => {
    if (folderSources.length === 0) return;

    setIsScanning(true);
    let totalImported = 0;

    for (const folder of folderSources) {
      setStatus(`Scanning "${folder.name}"...`);
      try {
        const result = await scanAndImportFolder(folder.uri);
        totalImported += result.booksImported;
      } catch (error) {
        console.error(`Error scanning ${folder.name}:`, error);
      }
    }

    setStatus(
      totalImported > 0
        ? `Imported ${totalImported} new book${totalImported === 1 ? "" : "s"}`
        : "No new audiobooks found"
    );
    setIsScanning(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Audiobook Sources</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Folder Sources List */}
        {folderSources.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Selected Folders</Text>
              <Pressable
                style={styles.rescanAllButton}
                onPress={handleRescanAll}
                disabled={isScanning}
              >
                <Ionicons name="refresh" size={16} color={colors.white} />
                <Text style={styles.rescanAllText}>Rescan All</Text>
              </Pressable>
            </View>

            {folderSources.map((folder) => (
              <View key={folder.id} style={styles.folderItem}>
                <View style={styles.folderIcon}>
                  <Ionicons name="folder" size={24} color={colors.red} />
                </View>
                <View style={styles.folderInfo}>
                  <Text style={styles.folderName} numberOfLines={1}>
                    {folder.name}
                  </Text>
                  <Text style={styles.folderUri} numberOfLines={1}>
                    {decodeURIComponent(folder.uri).split("/").slice(-2).join("/")}
                  </Text>
                </View>
                <Pressable
                  style={styles.folderAction}
                  onPress={() => handleRescanFolder(folder)}
                  disabled={isScanning}
                  hitSlop={8}
                >
                  <Ionicons name="refresh" size={20} color={colors.lightGrey} />
                </Pressable>
                <Pressable
                  style={styles.folderAction}
                  onPress={() => handleRemoveFolder(folder)}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.red} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Empty State / Add Folder */}
        <View style={styles.addSection}>
          {folderSources.length === 0 && (
            <>
              <Ionicons
                name="folder-open-outline"
                size={64}
                color={colors.lightGrey}
              />
              <Text style={styles.title}>No Folders Selected</Text>
              <Text style={styles.subtitle}>
                Add a folder containing your audiobooks. Each subfolder will be
                imported as a separate book.
              </Text>
            </>
          )}

          {status && (
            <View style={styles.statusContainer}>
              {isScanning && (
                <ActivityIndicator
                  size="small"
                  color={colors.red}
                  style={styles.spinner}
                />
              )}
              <Text style={styles.statusText}>{status}</Text>
            </View>
          )}

          <Pressable
            style={[
              styles.addButton,
              (isLoading || isScanning) && styles.addButtonDisabled,
            ]}
            onPress={handleAddFolder}
            disabled={isLoading || isScanning}
          >
            <Ionicons
              name="add"
              size={24}
              color={colors.white}
              style={styles.buttonIcon}
            />
            <Text style={styles.addButtonText}>Add Folder</Text>
          </Pressable>

          <View style={styles.infoBox}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={colors.lightGrey}
            />
            <Text style={styles.infoText}>
              You can add multiple folders. Each folder will be scanned for
              audiobooks. Books already imported will be skipped.
            </Text>
          </View>
        </View>
      </ScrollView>
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: colors.white,
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
  },
  rescanAllButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  rescanAllText: {
    fontSize: 13,
    color: colors.white,
    fontWeight: "500",
  },
  folderItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.darkGrey,
    justifyContent: "center",
    alignItems: "center",
  },
  folderInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  folderName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.white,
    marginBottom: 2,
  },
  folderUri: {
    fontSize: 12,
    color: colors.lightGrey,
  },
  folderAction: {
    padding: 8,
  },
  addSection: {
    alignItems: "center",
    paddingVertical: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.white,
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.lightGrey,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  spinner: {
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: colors.lightGrey,
    textAlign: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.red,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 24,
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  buttonIcon: {
    marginRight: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.mediumGrey,
    padding: 12,
    borderRadius: 8,
    gap: 8,
    marginHorizontal: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.lightGrey,
    lineHeight: 18,
  },
});
