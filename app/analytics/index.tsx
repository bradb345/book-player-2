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
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BarChart } from "react-native-gifted-charts";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import { BookHistoryRow } from "@/components/BookHistoryRow";
import {
  BookHistory,
  getAllBookHistory,
  getFilteredBookHistory,
  getCompletionsPerMonth,
  getTotalListeningTime,
  getTotalListeningTimeForBook,
} from "@/services/database";
import { formatDuration } from "@/utils/format";

type FilterTab = "all" | "year" | "month";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface BookHistoryWithListening extends BookHistory {
  listeningTimeMs: number;
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [books, setBooks] = useState<BookHistoryWithListening[]>([]);
  const [completionsData, setCompletionsData] = useState<{ month: string; count: number }[]>([]);
  const [totalListeningMs, setTotalListeningMs] = useState(0);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const loadData = useCallback(async () => {
    try {
      const year = filter === "year" || filter === "month" ? currentYear : undefined;
      const month = filter === "month" ? currentMonth : undefined;

      const [history, completions, totalMs] = await Promise.all([
        filter === "all" ? getAllBookHistory() : getFilteredBookHistory(year, month),
        getCompletionsPerMonth(year),
        getTotalListeningTime(),
      ]);

      const withListening = await Promise.all(
        history.map(async (bh) => {
          const listeningTimeMs = await getTotalListeningTimeForBook(bh.id);
          return { ...bh, listeningTimeMs };
        })
      );

      setBooks(withListening);
      setCompletionsData(completions);
      setTotalListeningMs(totalMs);
    } catch (e) {
      console.error("Error loading analytics:", e);
    }
  }, [filter, currentYear, currentMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const completedBooks = books.filter((b) => b.completed_at !== null);
  const inProgressBooks = books.filter((b) => b.completed_at === null);

  // Build chart data - fill all 12 months for current year or show actual months
  const chartData = (() => {
    if (filter === "month") {
      // For single month, no monthly chart
      return [];
    }
    const months = filter === "year"
      ? Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, "0");
          return `${currentYear}-${m}`;
        })
      : (() => {
          // All time: get range from completions
          if (completionsData.length === 0) return [];
          const allMonths: string[] = [];
          const first = completionsData[0].month;
          const last = completionsData[completionsData.length - 1].month;
          let [y, m] = first.split("-").map(Number);
          const [endY, endM] = last.split("-").map(Number);
          while (y < endY || (y === endY && m <= endM)) {
            allMonths.push(`${y}-${String(m).padStart(2, "0")}`);
            m++;
            if (m > 12) { m = 1; y++; }
          }
          return allMonths;
        })();

    const countMap = new Map(completionsData.map((c) => [c.month, c.count]));
    return months.map((month) => ({
      value: countMap.get(month) ?? 0,
      label: MONTH_LABELS[parseInt(month.split("-")[1]) - 1],
      frontColor: colors.red,
    }));
  })();

  return (
    <View style={sharedStyles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[sharedStyles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable style={sharedStyles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <Text style={sharedStyles.headerTitle}>Analytics</Text>
        <View style={sharedStyles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {/* Summary Cards */}
        <View style={styles.cardsRow}>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{books.length}</Text>
            <Text style={styles.cardLabel}>Started</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{completedBooks.length}</Text>
            <Text style={styles.cardLabel}>Completed</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardValue}>{formatDuration(totalListeningMs)}</Text>
            <Text style={styles.cardLabel}>Listened</Text>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          {(["all", "year", "month"] as FilterTab[]).map((tab) => (
            <Pressable
              key={tab}
              style={[styles.filterTab, filter === tab && styles.filterTabActive]}
              onPress={() => setFilter(tab)}
            >
              <Text style={[styles.filterTabText, filter === tab && styles.filterTabTextActive]}>
                {tab === "all" ? "All Time" : tab === "year" ? "This Year" : "This Month"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Bar Chart */}
        {chartData.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.sectionTitle}>Completions per Month</Text>
            <View style={styles.chartContainer}>
              <BarChart
                data={chartData}
                barWidth={20}
                spacing={12}
                noOfSections={Math.max(1, Math.max(...chartData.map((d) => d.value)))}
                barBorderRadius={4}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={colors.lightGrey}
                yAxisTextStyle={{ color: colors.lightGrey, fontSize: 11 }}
                xAxisLabelTextStyle={{ color: colors.lightGrey, fontSize: 10 }}
                hideRules
                isAnimated
                width={Math.max(200, chartData.length * 34)}
              />
            </View>
          </View>
        )}

        {/* Completed Books */}
        {completedBooks.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.sectionTitle}>Completed ({completedBooks.length})</Text>
            {completedBooks.map((book) => (
              <BookHistoryRow
                key={book.id}
                book={book}
                onPress={() => router.push(`/analytics/${book.id}`)}
              />
            ))}
          </View>
        )}

        {/* In Progress */}
        {inProgressBooks.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.sectionTitle}>In Progress ({inProgressBooks.length})</Text>
            {inProgressBooks.map((book) => (
              <BookHistoryRow
                key={book.id}
                book={book}
                onPress={() => router.push(`/analytics/${book.id}`)}
              />
            ))}
          </View>
        )}

        {books.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="analytics-outline" size={64} color={colors.lightGrey} />
            <Text style={styles.emptyText}>No listening history yet</Text>
            <Text style={styles.emptySubtext}>Start playing a book to see your stats</Text>
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
  cardsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  card: {
    flex: 1,
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  cardValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.white,
    marginBottom: 2,
  },
  cardLabel: {
    fontSize: 12,
    color: colors.lightGrey,
  },
  filterRow: {
    flexDirection: "row",
    backgroundColor: colors.mediumGrey,
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  filterTabActive: {
    backgroundColor: colors.red,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.lightGrey,
  },
  filterTabTextActive: {
    color: colors.white,
  },
  chartSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    marginBottom: 12,
  },
  chartContainer: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 16,
    paddingRight: 24,
    overflow: "hidden",
  },
  listSection: {
    marginBottom: 24,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 18,
    color: colors.white,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.lightGrey,
  },
});
