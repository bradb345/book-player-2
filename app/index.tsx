import { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  SectionList,
  Modal,
  TextInput,
  Alert,
  Image,
  AppState,
  AppStateStatus,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import {
  getAllBooks,
  Book,
  getProgress,
  Progress,
  deleteBook,
  updateBookTitle,
  resetBookProgress,
  getAllFolderSources,
} from "@/services/database";
import { deleteBookFiles, scanAndImportFolder } from "@/services/scanner";
import { useAudio } from "@/services/audioContext";

interface BookWithProgress extends Book {
  progress: Progress | null;
}

interface BookSection {
  title: string;
  data: BookWithProgress[];
}

type MenuAction = "edit" | "reset" | "delete";

export default function HomeScreen() {
  const [books, setBooks] = useState<BookWithProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState<BookWithProgress | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isPlaying, currentBookId, togglePlayback } = useAudio();
  const appState = useRef(AppState.currentState);

  const loadBooks = useCallback(async () => {
    try {
      setIsLoading(true);
      const allBooks = await getAllBooks();
      const booksWithProgress: BookWithProgress[] = await Promise.all(
        allBooks.map(async (book) => {
          const progress = await getProgress(book.id);
          return { ...book, progress };
        })
      );
      setBooks(booksWithProgress);
    } catch (error) {
      console.error("Error loading books:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const scanAllFolders = useCallback(async () => {
    try {
      const folderSources = await getAllFolderSources();
      let newBooksFound = false;

      for (const source of folderSources) {
        const result = await scanAndImportFolder(source.uri);
        if (result.success && result.booksImported > 0) {
          newBooksFound = true;
        }
      }

      if (newBooksFound) {
        await loadBooks();
      }
    } catch (error) {
      console.error("Error scanning folders:", error);
    }
  }, [loadBooks]);

  useFocusEffect(
    useCallback(() => {
      loadBooks();
      // Scan for new books when screen gains focus
      scanAllFolders();
    }, [loadBooks, scanAllFolders])
  );

  // Also scan when app comes to foreground
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
        if (appState.current.match(/inactive|background/) && nextAppState === "active") {
          scanAllFolders();
        }
        appState.current = nextAppState;
      });

      return () => {
        subscription.remove();
      };
    }, [scanAllFolders])
  );

  const sections = useMemo((): BookSection[] => {
    const inProgress = books.filter((book) => book.progress !== null);
    const notStarted = books.filter((book) => book.progress === null);

    const result: BookSection[] = [];

    if (inProgress.length > 0) {
      // Sort by last played (most recent first)
      inProgress.sort((a, b) => {
        const aTime = a.progress?.last_played_at || "";
        const bTime = b.progress?.last_played_at || "";
        return bTime.localeCompare(aTime);
      });
      result.push({ title: "In Progress", data: inProgress });
    }

    if (notStarted.length > 0) {
      // Sort alphabetically
      notStarted.sort((a, b) => a.title.localeCompare(b.title));
      result.push({ title: "Not Started", data: notStarted });
    }

    return result;
  }, [books]);

  const handleLongPress = (book: BookWithProgress) => {
    setSelectedBook(book);
    setMenuVisible(true);
  };

  const handleMenuAction = async (action: MenuAction) => {
    if (!selectedBook) return;

    setMenuVisible(false);

    switch (action) {
      case "edit":
        setEditTitle(selectedBook.title);
        setEditModalVisible(true);
        break;

      case "reset":
        Alert.alert(
          "Reset Progress",
          `Are you sure you want to reset progress for "${selectedBook.title}"?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Reset",
              style: "destructive",
              onPress: async () => {
                await resetBookProgress(selectedBook.id);
                loadBooks();
              },
            },
          ]
        );
        break;

      case "delete":
        Alert.alert(
          "Delete Book",
          `Are you sure you want to delete "${selectedBook.title}"? This will remove it from your library and delete the imported files.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                await deleteBookFiles(selectedBook.id);
                await deleteBook(selectedBook.id);
                loadBooks();
              },
            },
          ]
        );
        break;
    }
  };

  const handleSaveTitle = async () => {
    if (!selectedBook || !editTitle.trim()) return;

    await updateBookTitle(selectedBook.id, editTitle.trim());
    setEditModalVisible(false);
    setSelectedBook(null);
    loadBooks();
  };

  const handleBookPress = (book: BookWithProgress) => {
    router.push(`/player/${book.id}`);
  };

  const renderBookItem = ({ item }: { item: BookWithProgress }) => {
    // Only calculate progress if we have valid duration data
    const hasValidProgress = item.progress && item.progress.position_ms > 0 && item.total_duration_ms > 0;
    const progressPercent = hasValidProgress
      ? Math.min(100, (item.progress!.position_ms / item.total_duration_ms) * 100)
      : 0;

    return (
      <Pressable
        style={styles.listItem}
        onPress={() => handleBookPress(item)}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={300}
      >
        <View style={styles.listCover}>
          {item.cover_path ? (
            <Image source={{ uri: item.cover_path }} style={styles.coverImage} />
          ) : (
            <Ionicons name="book" size={28} color={colors.lightGrey} />
          )}
        </View>
        <View style={styles.listInfo}>
          <Text style={styles.listTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.author && (
            <Text style={styles.listAuthor} numberOfLines={1}>
              {item.author}
            </Text>
          )}
          {item.progress && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${progressPercent}%` }]}
                />
              </View>
              {hasValidProgress ? (
                <Text style={styles.progressText}>{Math.round(progressPercent)}%</Text>
              ) : (
                <Text style={styles.progressText}>Started</Text>
              )}
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.lightGrey} />
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: BookSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="library-outline" size={64} color={colors.lightGrey} />
      <Text style={styles.emptyText}>No audiobooks yet</Text>
      <Text style={styles.emptySubtext}>Tap the + button to add a folder</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Text style={styles.headerTitle}>Audiobooks</Text>
        <View style={styles.headerIcons}>
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
      {books.length === 0 && !isLoading ? (
        renderEmptyState()
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderBookItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: insets.bottom + 80 },
          ]}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* Floating Action Button - Play/Pause when playing, Add when not */}
      <Pressable
        style={[styles.addButton, { bottom: insets.bottom + 24 }]}
        onPress={() => {
          if (currentBookId !== null) {
            togglePlayback();
          } else {
            router.push("/select-folder");
          }
        }}
      >
        <Ionicons
          name={currentBookId !== null ? (isPlaying ? "pause" : "play") : "add"}
          size={32}
          color={colors.white}
          style={currentBookId !== null && !isPlaying ? styles.playIconOffset : undefined}
        />
      </Pressable>

      {/* Long Press Menu Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {selectedBook?.title}
            </Text>

            <Pressable
              style={styles.menuItem}
              onPress={() => handleMenuAction("edit")}
            >
              <Ionicons name="pencil" size={22} color={colors.white} />
              <Text style={styles.menuItemText}>Edit Title</Text>
            </Pressable>

            {selectedBook?.progress && (
              <Pressable
                style={styles.menuItem}
                onPress={() => handleMenuAction("reset")}
              >
                <Ionicons name="refresh" size={22} color={colors.white} />
                <Text style={styles.menuItemText}>Reset Progress</Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => handleMenuAction("delete")}
            >
              <Ionicons name="trash" size={22} color={colors.red} />
              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>
                Delete Book
              </Text>
            </Pressable>

            <Pressable
              style={styles.menuCancel}
              onPress={() => setMenuVisible(false)}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Edit Title Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setEditModalVisible(false)}
        >
          <Pressable style={styles.editContainer} onPress={() => {}}>
            <Text style={styles.editTitle}>Edit Title</Text>
            <TextInput
              style={styles.editInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Book title"
              placeholderTextColor={colors.lightGrey}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.editButtons}>
              <Pressable
                style={styles.editButton}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.editButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.editButton, styles.editButtonPrimary]}
                onPress={handleSaveTitle}
              >
                <Text style={[styles.editButtonText, styles.editButtonTextPrimary]}>
                  Save
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 18,
    color: colors.white,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.lightGrey,
  },
  listContainer: {
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.white,
  },
  sectionCount: {
    fontSize: 14,
    color: colors.lightGrey,
    backgroundColor: colors.mediumGrey,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  listCover: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.darkGrey,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  coverImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  listInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    marginBottom: 2,
  },
  listAuthor: {
    fontSize: 14,
    color: colors.lightGrey,
    marginBottom: 6,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: colors.darkGrey,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.red,
  },
  progressText: {
    fontSize: 12,
    color: colors.lightGrey,
    minWidth: 32,
  },
  addButton: {
    position: "absolute",
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
  playIconOffset: {
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  menuContainer: {
    backgroundColor: colors.mediumGrey,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.lightGrey,
    textAlign: "center",
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  menuItemText: {
    fontSize: 17,
    color: colors.white,
  },
  menuItemDanger: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lightGrey,
    marginTop: 8,
    paddingTop: 20,
  },
  menuItemTextDanger: {
    color: colors.red,
  },
  menuCancel: {
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: colors.darkGrey,
    borderRadius: 12,
    alignItems: "center",
  },
  menuCancelText: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.white,
  },
  editContainer: {
    backgroundColor: colors.mediumGrey,
    marginHorizontal: 20,
    marginBottom: 100,
    borderRadius: 16,
    padding: 20,
    alignSelf: "center",
    width: "90%",
    maxWidth: 400,
    position: "absolute",
    top: "30%",
  },
  editTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.white,
    marginBottom: 16,
    textAlign: "center",
  },
  editInput: {
    backgroundColor: colors.darkGrey,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: colors.white,
    marginBottom: 20,
  },
  editButtons: {
    flexDirection: "row",
    gap: 12,
  },
  editButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.darkGrey,
  },
  editButtonPrimary: {
    backgroundColor: colors.red,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
  },
  editButtonTextPrimary: {
    color: colors.white,
  },
});
