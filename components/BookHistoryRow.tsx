import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { BookHistory } from "@/services/database";
import { formatDate, daysBetween } from "@/utils/format";

interface BookHistoryRowProps {
  book: BookHistory;
  onPress: () => void;
}

export function BookHistoryRow({ book, onPress }: BookHistoryRowProps) {
  const isCompleted = book.completed_at !== null;

  return (
    <Pressable style={styles.bookRow} onPress={onPress}>
      <View style={styles.bookCover}>
        {book.cover_path ? (
          <Image source={{ uri: book.cover_path }} style={styles.coverImage} />
        ) : (
          <Ionicons name="book" size={24} color={colors.lightGrey} />
        )}
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
            ? `${formatDate(book.started_at)} — ${formatDate(book.completed_at!)} (${daysBetween(book.started_at, book.completed_at!)}d)`
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
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
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
  coverImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
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
