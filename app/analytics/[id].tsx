import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import {
  BookHistory,
  getBookHistoryById,
  getTotalListeningTimeForBook,
  deleteBookHistory,
} from "@/services/database";
import { formatDuration, formatDate, daysBetween } from "@/utils/format";
import { BookCover } from "@/components/BookCover";
import { ProgressRing } from "@/components/ProgressRing";
import { NotFoundScreen } from "@/components/NotFoundScreen";

interface StatRow {
  label: string;
  value: string;
  green?: boolean;
}

export default function BookAnalyticsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [book, setBook] = useState<BookHistory | null>(null);
  const [listeningTimeMs, setListeningTimeMs] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const load = async () => {
        const bh = await getBookHistoryById(parseInt(id));
        setBook(bh);
        if (bh) {
          const time = await getTotalListeningTimeForBook(bh.id);
          setListeningTimeMs(time);
        }
      };
      load();
    }, [id])
  );

  if (!book) {
    return <NotFoundScreen message="Book not found" />;
  }

  const isCompleted = book.completed_at !== null;
  const daysToFinish = isCompleted ? daysBetween(book.started_at, book.completed_at!) : null;

  // Estimate remaining time based on listening pace
  const estimatedRemaining = (() => {
    if (isCompleted || book.total_duration_ms === 0 || listeningTimeMs === 0) return null;
    const remaining = book.total_duration_ms - listeningTimeMs;
    return remaining > 0 ? remaining : null;
  })();

  // Ring fill: a finished book is 100%; otherwise how much of the book has
  // been listened to (capped at 100% in case of overlap/replays).
  const progress = isCompleted
    ? 1
    : book.total_duration_ms > 0
      ? Math.min(1, listeningTimeMs / book.total_duration_ms)
      : 0;
  const progressPercent = Math.round(progress * 100);

  const rows: StatRow[] = [
    { label: "Status", value: isCompleted ? "Completed" : "In Progress", green: isCompleted },
    { label: "Time Listened", value: formatDuration(listeningTimeMs) },
    { label: "Started", value: formatDate(book.started_at) },
  ];
  if (isCompleted) {
    rows.push({ label: "Completed", value: formatDate(book.completed_at!) });
    if (daysToFinish !== null) {
      rows.push({
        label: "Days to Finish",
        value: `${daysToFinish} day${daysToFinish !== 1 ? "s" : ""}`,
      });
    }
    if (book.total_duration_ms > 0) {
      rows.push({ label: "Book Duration", value: formatDuration(book.total_duration_ms) });
    }
  } else {
    rows.push({
      label: "Est. Remaining",
      value: estimatedRemaining ? formatDuration(estimatedRemaining) : "—",
    });
  }

  const handleRemoveFromHistory = () => {
    Alert.alert(
      "Remove from History",
      `Remove "${book.title}" from your listening history?\n\nThis only clears it from Analytics — the book's audio files in your folder are not deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteBookHistory(book.id);
              router.back();
            } catch (e) {
              console.error("Error removing book history:", e);
              Alert.alert("Error", "Could not remove this entry. Please try again.");
            }
          },
        },
      ]
    );
  };

  return (
    <View style={sharedStyles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[sharedStyles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable style={sharedStyles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <Text style={[sharedStyles.headerTitle, { fontSize: 18 }]} numberOfLines={1}>{book.title}</Text>
        <View style={sharedStyles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* Hero: cover inside a progress ring */}
        <View style={styles.hero}>
          <ProgressRing progress={progress} size={180} strokeWidth={9}>
            <View style={styles.coverCircle}>
              <BookCover coverPath={book.cover_path} iconSize={56} />
            </View>
          </ProgressRing>
          <Text style={styles.bookTitle}>{book.title}</Text>
          {book.author && <Text style={styles.bookAuthor}>{book.author}</Text>}
          {!book.is_in_library && (
            <View style={styles.removedLabel}>
              <Ionicons name="trash-outline" size={14} color={colors.red} />
              <Text style={styles.removedLabelText}>Removed from Library</Text>
            </View>
          )}
          <Text style={styles.progressCaption}>
            {isCompleted ? "Completed" : `${progressPercent}% complete`}
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.group}>
          {rows.map((row, i) => (
            <View
              key={row.label}
              style={[styles.statRow, i < rows.length - 1 && styles.rowDivider]}
            >
              <Text style={styles.statLabel}>{row.label}</Text>
              <Text style={[styles.statValue, row.green && styles.statValueGreen]}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {!book.is_in_library && (
          <Pressable style={styles.removeButton} onPress={handleRemoveFromHistory}>
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <Text style={styles.removeButtonText}>Remove from History</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
  },
  hero: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  coverCircle: {
    width: 138,
    height: 138,
    borderRadius: 69,
    backgroundColor: colors.mediumGrey,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  bookTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: colors.white,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 4,
  },
  bookAuthor: {
    fontSize: 16,
    color: colors.lightGrey,
    textAlign: "center",
  },
  removedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  removedLabelText: {
    fontSize: 13,
    color: colors.red,
    fontWeight: "500",
  },
  progressCaption: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.green,
    marginTop: 12,
  },
  group: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  statLabel: {
    fontSize: 14,
    color: colors.white,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.white,
  },
  statValueGreen: {
    color: colors.green,
  },
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.mediumGrey,
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.red,
  },
});
