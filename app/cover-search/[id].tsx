// "Cover from internet" picker — the port of Voice's SelectCoverFromInternet
// screen. A search field pre-filled with the book's title (+ author), a grid
// of DuckDuckGo image results, tap one to download it and set it as the
// book's cover, then return to the library (which reloads covers on focus).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import { getBookWithChapters, updateBookCover } from "@/services/database";
import { searchCovers, downloadCover, CoverResult } from "@/services/coverSearch";

const COLUMNS = 3;
const GAP = 8;

type Status = "loading" | "ready" | "error";

export default function CoverSearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = parseInt(id ?? "", 10);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoverResult[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [saving, setSaving] = useState(false);

  // Ignore responses from a search that's been superseded by a newer one.
  const searchSeq = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    setStatus("loading");
    try {
      const found = await searchCovers(q);
      if (seq !== searchSeq.current) return;
      setResults(found);
      setStatus("ready");
    } catch {
      if (seq !== searchSeq.current) return;
      setResults([]);
      setStatus("error");
    }
  }, []);

  // Seed the query from the book's title/author, then run the first search.
  useEffect(() => {
    let active = true;
    (async () => {
      if (Number.isNaN(bookId)) {
        setStatus("error");
        return;
      }
      const data = await getBookWithChapters(bookId);
      if (!active) return;
      const book = data?.book;
      const seed = book
        ? [book.title, book.author].filter(Boolean).join(" ")
        : "";
      setQuery(seed);
      runSearch(seed);
    })();
    return () => {
      active = false;
    };
  }, [bookId, runSearch]);

  const handlePick = async (result: CoverResult) => {
    if (saving) return;
    setSaving(true);
    const saved = await downloadCover(bookId, result);
    if (saved) {
      try {
        await updateBookCover(bookId, saved);
      } catch {
        setSaving(false);
        setStatus("error");
        return;
      }
      setSaving(false);
      router.back();
    } else {
      setSaving(false);
      setStatus("error");
    }
  };

  const screenWidth = Dimensions.get("window").width;
  const cellSize = Math.floor(
    (screenWidth - 32 - GAP * (COLUMNS - 1)) / COLUMNS,
  );

  const renderItem = ({ item }: { item: CoverResult }) => (
    <Pressable
      style={[styles.cell, { width: cellSize, height: cellSize }]}
      onPress={() => handlePick(item)}
    >
      <Image
        source={{ uri: item.thumbnail }}
        style={styles.thumb}
        resizeMode="cover"
      />
    </Pressable>
  );

  return (
    <View style={sharedStyles.container}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.lightGrey} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query)}
            placeholder="Search for a cover"
            placeholderTextColor={colors.lightGrey}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.lightGrey} />
            </Pressable>
          )}
        </View>
      </View>

      {status === "loading" && (
        <View style={[sharedStyles.centered, styles.fill]}>
          <ActivityIndicator size="large" color={colors.red} />
        </View>
      )}

      {status === "error" && (
        <View style={[sharedStyles.centered, styles.fill]}>
          <Ionicons name="cloud-offline-outline" size={56} color={colors.lightGrey} />
          <Text style={styles.stateText}>Couldn&apos;t load covers</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => runSearch(query)}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {status === "ready" && results.length === 0 && (
        <View style={[sharedStyles.centered, styles.fill]}>
          <Ionicons name="image-outline" size={56} color={colors.lightGrey} />
          <Text style={styles.stateText}>No covers found</Text>
        </View>
      )}

      {status === "ready" && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item, i) => `${item.image}_${i}`}
          renderItem={renderItem}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + 24 },
          ]}
        />
      )}

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator size="large" color={colors.white} />
          <Text style={styles.savingText}>Saving cover…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.mediumGrey,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.white,
    fontSize: 15,
    paddingVertical: 0,
  },
  fill: {
    flex: 1,
    gap: 12,
  },
  stateText: {
    fontSize: 16,
    color: colors.lightGrey,
  },
  retryButton: {
    backgroundColor: colors.red,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  retryText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "600",
  },
  grid: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  row: {
    gap: GAP,
    marginBottom: GAP,
  },
  cell: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.mediumGrey,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  savingText: {
    color: colors.white,
    fontSize: 15,
  },
});
