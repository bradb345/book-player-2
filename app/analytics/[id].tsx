import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ScrollView,
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
} from "@/services/database";
import { formatDuration, formatDate, daysBetween } from "@/utils/format";
import { BookCover } from "@/components/BookCover";
import { NotFoundScreen } from "@/components/NotFoundScreen";

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
        {/* Book Info */}
        <View style={styles.bookHeader}>
          <View style={styles.coverLarge}>
            <BookCover coverPath={book.cover_path} iconSize={60} />
          </View>
          <Text style={styles.bookTitle}>{book.title}</Text>
          {book.author && <Text style={styles.bookAuthor}>{book.author}</Text>}
          {!book.is_in_library && (
            <View style={styles.removedLabel}>
              <Ionicons name="trash-outline" size={14} color={colors.red} />
              <Text style={styles.removedLabelText}>Removed from Library</Text>
            </View>
          )}
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Started</Text>
            <Text style={styles.statValue}>{formatDate(book.started_at)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, isCompleted && styles.statValueGreen]}>
              {isCompleted ? "Completed" : "In Progress"}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Time Listened</Text>
            <Text style={styles.statValue}>{formatDuration(listeningTimeMs)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>
              {isCompleted ? "Time to Complete" : "Est. Remaining"}
            </Text>
            <Text style={styles.statValue}>
              {isCompleted && daysToFinish
                ? `${daysToFinish} day${daysToFinish !== 1 ? "s" : ""}`
                : estimatedRemaining
                  ? formatDuration(estimatedRemaining)
                  : "—"}
            </Text>
          </View>
        </View>

        {/* Completion Details */}
        {isCompleted && (
          <View style={styles.completionSection}>
            <Text style={styles.sectionTitle}>Completion Details</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Completed</Text>
              <Text style={styles.detailValue}>{formatDate(book.completed_at!)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Days to Finish</Text>
              <Text style={styles.detailValue}>{daysToFinish}</Text>
            </View>
            {book.total_duration_ms > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Book Duration</Text>
                <Text style={styles.detailValue}>{formatDuration(book.total_duration_ms)}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
  },
  bookHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  coverLarge: {
    width: 140,
    height: 140,
    borderRadius: 16,
    backgroundColor: colors.mediumGrey,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    marginBottom: 16,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  bookTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: colors.white,
    textAlign: "center",
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
    backgroundColor: colors.mediumGrey,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removedLabelText: {
    fontSize: 13,
    color: colors.red,
    fontWeight: "500",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 14,
  },
  statLabel: {
    fontSize: 12,
    color: colors.lightGrey,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.white,
  },
  statValueGreen: {
    color: "#34C759",
  },
  completionSection: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.darkGrey,
  },
  detailLabel: {
    fontSize: 14,
    color: colors.lightGrey,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.white,
  },
});
