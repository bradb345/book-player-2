import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import {
  BookHistory,
  Note,
  getBookHistoryById,
  getNotesForBookHistory,
  insertNote,
  deleteNote,
} from "@/services/database";
import { useAudio } from "@/services/audioContext";
import { formatPlaybackTime } from "@/utils/format";
import { BookCover } from "@/components/BookCover";
import { NotFoundScreen } from "@/components/NotFoundScreen";

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state } = useAudio();

  const bookHistoryId = id ? parseInt(id) : NaN;

  const [history, setHistory] = useState<BookHistory | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<Note> | null>(null);

  // Cumulative position is available when the audio context has loaded the
  // same book this history record points to. Otherwise (e.g. opened from
  // analytics for a removed book) the note saves without a timestamp.
  const livePosition = useMemo(() => {
    if (!history?.book_id) return null;
    if (!state.book || state.book.id !== history.book_id) return null;
    let cumulativeMs = 0;
    for (let i = 0; i < state.currentChapterIndex && i < state.chapters.length; i++) {
      cumulativeMs += state.chapters[i].duration_ms;
    }
    cumulativeMs += state.positionMs;
    const chapterTitle = state.chapters[state.currentChapterIndex]?.title ?? null;
    return { positionMs: cumulativeMs, chapterTitle };
  }, [history?.book_id, state.book, state.chapters, state.currentChapterIndex, state.positionMs]);

  useFocusEffect(
    useCallback(() => {
      if (!Number.isFinite(bookHistoryId)) return;
      const load = async () => {
        const [bh, n] = await Promise.all([
          getBookHistoryById(bookHistoryId),
          getNotesForBookHistory(bookHistoryId),
        ]);
        setHistory(bh);
        // Oldest first so the newest note sits next to the compose bar.
        setNotes(n.slice().reverse());
        setLoaded(true);
      };
      load();
    }, [bookHistoryId])
  );

  const handleSave = async () => {
    const text = draft.trim();
    if (!text || !history) return;
    try {
      const note = await insertNote(
        history.id,
        text,
        livePosition?.positionMs ?? null,
        livePosition?.chapterTitle ?? null,
      );
      setNotes((prev) => [...prev, note]);
      setDraft("");
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    } catch (e) {
      console.error("Error saving note:", e);
      Alert.alert("Error", "Could not save your note. Please try again.");
    }
  };

  const handleDelete = (note: Note) => {
    Alert.alert("Delete note?", note.text.slice(0, 80), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNote(note.id);
            setNotes((prev) => prev.filter((n) => n.id !== note.id));
          } catch (e) {
            console.error("Error deleting note:", e);
            Alert.alert("Error", "Could not delete this note.");
          }
        },
      },
    ]);
  };

  if (loaded && !history) {
    return <NotFoundScreen message="Book not found" />;
  }

  const placeholder = livePosition
    ? `Add a note at ${formatPlaybackTime(livePosition.positionMs)}…`
    : notes.length === 0
      ? "Add your first note…"
      : "Add a note…";

  return (
    <KeyboardAvoidingView
      style={sharedStyles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[sharedStyles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable style={sharedStyles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <Text style={[sharedStyles.headerTitle, { fontSize: 18 }]}>Notes</Text>
        <View style={sharedStyles.headerSpacer} />
      </View>

      {/* Book context strip */}
      {history && (
        <View style={styles.context}>
          <View style={styles.miniCover}>
            <BookCover coverPath={history.cover_path} iconSize={20} />
          </View>
          <View style={styles.contextText}>
            <Text style={styles.contextTitle} numberOfLines={1}>{history.title}</Text>
            <Text style={styles.contextSub}>
              {notes.length === 0 ? "No notes yet" : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
            </Text>
          </View>
        </View>
      )}

      {/* List or empty state */}
      {notes.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="create-outline" size={28} color={colors.lightGrey} />
          </View>
          <Text style={styles.emptyTitle}>No notes yet</Text>
          <Text style={styles.emptyText}>
            Capture thoughts, quotes, and references{"\n"}as you listen. Each note remembers{"\n"}where you were in the book.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={notes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => handleDelete(item)}
              style={styles.noteCard}
            >
              <View style={styles.noteMeta}>
                {item.position_ms != null ? (
                  <Text style={styles.noteTime}>
                    <Ionicons name="time-outline" size={11} color={colors.red} />
                    {"  "}
                    {formatPlaybackTime(item.position_ms)}
                    {item.chapter_title ? ` · ${item.chapter_title}` : ""}
                  </Text>
                ) : (
                  <Text style={styles.noteTime}>Note</Text>
                )}
                <Text style={styles.noteDate}>{formatNoteDate(item.created_at)}</Text>
              </View>
              <Text style={styles.noteText}>{item.text}</Text>
            </Pressable>
          )}
        />
      )}

      {/* Compose bar */}
      <View style={[styles.compose, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          style={styles.composeInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.lightGrey}
          multiline
        />
        <Pressable
          style={[styles.composeSend, !draft.trim() && styles.composeSendDisabled]}
          onPress={handleSave}
          disabled={!draft.trim()}
        >
          <Ionicons name="arrow-up" size={18} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.mediumGrey,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
  },
  miniCover: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: colors.darkGrey,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  contextText: {
    flex: 1,
    minWidth: 0,
  },
  contextTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.white,
  },
  contextSub: {
    fontSize: 12,
    color: colors.lightGrey,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  noteCard: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  noteMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  noteTime: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.red,
    flex: 1,
    marginRight: 8,
  },
  noteDate: {
    fontSize: 11,
    color: colors.lightGrey,
  },
  noteText: {
    fontSize: 14,
    color: colors.white,
    lineHeight: 20,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.mediumGrey,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.white,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: colors.lightGrey,
    textAlign: "center",
    lineHeight: 19,
  },
  compose: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.mediumGrey,
  },
  composeInput: {
    flex: 1,
    backgroundColor: colors.mediumGrey,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    color: colors.white,
    maxHeight: 140,
  },
  composeSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  composeSendDisabled: {
    opacity: 0.4,
  },
});
