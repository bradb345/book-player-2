import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { BookHistory } from "@/services/database";
import { formatDate, daysBetween } from "@/utils/format";
import { BookCover } from "@/components/BookCover";

interface BookHistoryRowProps {
  book: BookHistory;
  onPress: () => void;
  /** Last row in its group — suppresses the bottom divider. */
  isLast?: boolean;
}

export function BookHistoryRow({ book, onPress, isLast }: BookHistoryRowProps) {
  const isCompleted = book.completed_at !== null;

  return (
    <Pressable
      style={[styles.bookRow, !isLast && styles.divider]}
      onPress={onPress}
    >
      <View
        style={[
          styles.statusDot,
          { backgroundColor: isCompleted ? colors.green : colors.red },
        ]}
      />
      <View style={styles.bookCover}>
        <BookCover coverPath={book.cover_path} iconSize={24} />
      </View>
      <View style={styles.bookInfo}>
        <View style={styles.bookTitleRow}>
          <Text style={styles.bookTitle} numberOfLines={1}>{book.title}</Text>
          {!book.is_in_library && (
            <View style={styles.removedBadge}>
              <Text style={styles.removedBadgeText}>Removed</Text>
            </View>
          )}
        </View>
        {book.author && <Text style={styles.bookAuthor} numberOfLines={1}>{book.author}</Text>}
        <Text style={styles.bookMeta}>
          {isCompleted
            ? `${formatDate(book.started_at)} — ${formatDate(book.completed_at!)} · ${daysBetween(book.started_at, book.completed_at!)}d`
            : `Started ${formatDate(book.started_at)}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.lightGrey} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  bookCover: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.darkGrey,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  bookInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  bookTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bookTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.white,
    flexShrink: 1,
  },
  removedBadge: {
    backgroundColor: colors.red,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  removedBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.white,
  },
  bookAuthor: {
    fontSize: 13,
    color: colors.lightGrey,
    marginTop: 1,
  },
  bookMeta: {
    fontSize: 11,
    color: colors.lightGrey,
    marginTop: 2,
  },
});
