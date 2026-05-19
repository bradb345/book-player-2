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
import { ProgressRing } from "@/components/ProgressRing";
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

  const startedCount = books.length;
  const completedCount = completedBooks.length;
  const completionRate = startedCount > 0 ? completedCount / startedCount : 0;
  const completionPercent = Math.round(completionRate * 100);

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
        {books.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="analytics-outline" size={64} color={colors.lightGrey} />
            <Text style={styles.emptyText}>No listening history yet</Text>
            <Text style={styles.emptySubtext}>Start playing a book to see your stats</Text>
          </View>
        ) : (
          <>
            {/* Hero: library completion rate */}
            <View style={styles.hero}>
              <ProgressRing progress={completionRate} size={168} strokeWidth={9}>
                <Text style={styles.ringValue}>{completionPercent}%</Text>
                <Text style={styles.ringLabel}>COMPLETED</Text>
              </ProgressRing>
              <Text style={styles.heroCaption}>
                {completedCount} of {startedCount} book{startedCount !== 1 ? "s" : ""} finished{" "}
                <Text style={styles.heroCaptionMuted}>
                  · {formatDuration(totalListeningMs)} listened
                </Text>
              </Text>
            </View>

            {/* Summary */}
            <View style={styles.group}>
              <View style={[styles.summaryRow, styles.rowDivider]}>
                <Text style={styles.summaryLabel}>Books Started</Text>
                <Text style={styles.summaryValue}>{startedCount}</Text>
              </View>
              <View style={[styles.summaryRow, styles.rowDivider]}>
                <Text style={styles.summaryLabel}>Completed</Text>
                <Text style={[styles.summaryValue, styles.summaryValueGreen]}>{completedCount}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total Listened</Text>
                <Text style={styles.summaryValue}>{formatDuration(totalListeningMs)}</Text>
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
                <View style={styles.group}>
                  {completedBooks.map((book, i) => (
                    <BookHistoryRow
                      key={book.id}
                      book={book}
                      isLast={i === completedBooks.length - 1}
                      onPress={() => router.push(`/analytics/${book.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* In Progress */}
            {inProgressBooks.length > 0 && (
              <View style={styles.listSection}>
                <Text style={styles.sectionTitle}>In Progress ({inProgressBooks.length})</Text>
                <View style={styles.group}>
                  {inProgressBooks.map((book, i) => (
                    <BookHistoryRow
                      key={book.id}
                      book={book}
                      isLast={i === inProgressBooks.length - 1}
                      onPress={() => router.push(`/analytics/${book.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}
          </>
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
  ringValue: {
    fontSize: 38,
    fontWeight: "800",
    color: colors.green,
    letterSpacing: -0.5,
  },
  ringLabel: {
    fontSize: 12,
    color: colors.lightGrey,
    letterSpacing: 1,
    marginTop: 4,
  },
  heroCaption: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.white,
    marginTop: 14,
    textAlign: "center",
  },
  heroCaptionMuted: {
    color: colors.lightGrey,
    fontWeight: "400",
  },
  group: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 22,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.white,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.white,
  },
  summaryValueGreen: {
    color: colors.green,
  },
  filterRow: {
    flexDirection: "row",
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 4,
    marginBottom: 22,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: 9,
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
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.lightGrey,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  chartContainer: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 16,
    padding: 16,
    paddingRight: 24,
    overflow: "hidden",
  },
  listSection: {
    marginBottom: 22,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
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
