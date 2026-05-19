import { Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";

interface BookCoverProps {
  coverPath: string | null;
  /** Size of the fallback book icon shown when there is no cover image. */
  iconSize: number;
  /** Show a spinner instead of the cover/placeholder (e.g. while a book loads). */
  loading?: boolean;
}

/**
 * Renders a book's cover art, falling back to a book icon when none exists.
 * The caller owns the surrounding container (size, radius, background).
 */
export function BookCover({ coverPath, iconSize, loading = false }: BookCoverProps) {
  if (loading) {
    return <ActivityIndicator size="large" color={colors.lightGrey} />;
  }
  if (coverPath) {
    return <Image source={{ uri: coverPath }} style={sharedStyles.coverImage} />;
  }
  return <Ionicons name="book" size={iconSize} color={colors.lightGrey} />;
}
