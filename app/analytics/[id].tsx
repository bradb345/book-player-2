import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ScrollView,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import {
  BookHistory,
  getBookHistoryById,
  getTotalListeningTimeForBook,
} from "@/services/database";

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

  const formatDuration = (ms: number): string => {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const daysBetween = (start: string, end: string): number => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
  };

  if (!book) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.emptyText}>Book not found</Text>
        <Pressable style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
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
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{book.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* Book Info */}
        <View style={styles.bookHeader}>
          <View style={styles.coverLarge}>
            {book.cover_path ? (
              <Image source={{ uri: book.cover_path }} style={styles.coverImage} />
            ) : (
              <Ionicons name="book" size={60} color={colors.lightGrey} />
            )}
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
  container: {
    flex: 1,
    backgroundColor: colors.darkGrey,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: colors.lightGrey,
    marginBottom: 16,
  },
  backButtonLarge: {
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "bold",
    color: colors.white,
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
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
  coverImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
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
