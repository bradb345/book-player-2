// JS surface for the local native module that reads embedded cover art out
// of an audio file. Android uses MediaMetadataRetriever (handles SAF
// content:// URIs without copying the file); iOS uses AVAsset. This is the
// same approach Voice uses natively.
//
// requireNativeModule throws if the native side isn't present (e.g. the dev
// client hasn't been rebuilt yet). We swallow that so callers degrade to the
// pure-JS parser instead of crashing.

import { requireNativeModule } from "expo-modules-core";

interface AudioMetadataNativeModule {
  // Returns the embedded artwork as a base64 string (no data: prefix), or
  // null when the file has none / can't be read.
  getEmbeddedArtwork(uri: string): Promise<string | null>;
}

let nativeModule: AudioMetadataNativeModule | null = null;
try {
  nativeModule = requireNativeModule<AudioMetadataNativeModule>("AudioMetadata");
} catch {
  nativeModule = null;
}

export const isNativeArtworkAvailable = nativeModule != null;

export async function getEmbeddedArtwork(uri: string): Promise<string | null> {
  if (!nativeModule) return null;
  try {
    return await nativeModule.getEmbeddedArtwork(uri);
  } catch {
    return null;
  }
}
