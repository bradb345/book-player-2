// JS surface for the iOS folder-bookmark native module.
//
// `pickDirectory({ requestLongTermAccess: true })` returns a base64 NSData
// bookmark that we persist alongside the folder source URI. To list that
// folder on a later launch (so syncLibrary can find newly-added books) we
// must resolve the bookmark back to a security-scoped URL and call
// startAccessingSecurityScopedResource() — there's no JS API in the picker
// library for this, so we expose it via a tiny native module.
//
// requireNativeModule throws if the native side isn't present (e.g. the dev
// client hasn't been rebuilt). We swallow that so sync degrades gracefully
// (iOS sources just don't pick up new books until a rebuild) rather than
// crashing.

import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

export interface ResolvedBookmark {
  // file:// URL resolved from the bookmark. May differ byte-for-byte from the
  // URI originally stored on pick (path normalization, alias resolution).
  uri: string;
  // True when iOS reports the bookmark data is stale and should be re-created
  // by re-picking the folder. The resolved URL is still usable this session.
  stale: boolean;
}

interface FolderBookmarkNativeModule {
  resolveBookmark(base64Bookmark: string): Promise<ResolvedBookmark | null>;
  releaseBookmark(uri: string): Promise<void>;
}

let nativeModule: FolderBookmarkNativeModule | null = null;
try {
  nativeModule = requireNativeModule<FolderBookmarkNativeModule>("FolderBookmark");
} catch {
  nativeModule = null;
}

// True only on iOS with the native module present. Android has no concept of
// security-scoped bookmarks — SAF grants are persistent through the URI.
export const isFolderBookmarkSupported =
  Platform.OS === "ios" && nativeModule != null;

export async function resolveBookmark(
  base64Bookmark: string
): Promise<ResolvedBookmark | null> {
  if (!nativeModule) return null;
  try {
    return await nativeModule.resolveBookmark(base64Bookmark);
  } catch (e) {
    console.warn("resolveBookmark failed:", e);
    return null;
  }
}

export async function releaseBookmark(uri: string): Promise<void> {
  if (!nativeModule) return;
  try {
    await nativeModule.releaseBookmark(uri);
  } catch (e) {
    console.warn("releaseBookmark failed:", e);
  }
}
