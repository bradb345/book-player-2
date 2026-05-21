import * as FileSystem from "expo-file-system/legacy";
import { StorageAccessFramework } from "expo-file-system/legacy";
import { Platform } from "react-native";
import {
  insertBook,
  insertChapter,
  bookExistsAtPath,
  deleteBook,
  updateBookCover,
} from "./database";
import { extractEmbeddedCover, imageExtFromName } from "./coverArt";
import { getErrorMessage } from "@/utils/error";
import { naturalCompare } from "@/utils/sort";

export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
// Files that commonly sit next to audio (metadata, art sidecars, playlists,
// logs). They are never directories, so we can skip the recurse-and-catch SAF
// probe for them — that probe is a native call that must fail before we move
// on, which adds up across a large library.
const COMPANION_FILE_EXTENSIONS = [
  ".txt", ".pdf", ".cue", ".opf", ".nfo", ".m3u", ".m3u8", ".log", ".json",
  ".xml", ".lrc", ".srt", ".vtt", ".db", ".ini", ".sfv", ".md5", ".epub",
];
const COVER_FILENAMES = ["cover", "folder", "front", "album", "artwork"];

interface ScannedFile {
  name: string;
  uri: string;
  // Relative path from the book root, used so nested files (e.g. CD1/01.mp3,
  // CD2/01.mp3) sort in the right order instead of colliding on basename.
  sortKey?: string;
}

// Guard against pathological deep trees / unexpected cycles while recursing.
const MAX_SCAN_DEPTH = 8;

interface ImportResult {
  success: boolean;
  booksImported: number;
  message: string;
}

interface PickResult {
  folderUri: string;
  folderName: string;
  // iOS only: opaque base64 NSData bookmark from the picker. Persisting it
  // lets syncLibrary re-acquire the security-scoped URL on later launches so
  // newly-added books in the source folder get imported. Null when the picker
  // could not produce a bookmark (the initial pick still works in-session).
  bookmark: string | null;
}

// A non-recoverable import condition that must abort the ENTIRE scan, not
// just skip one book. A per-file copy failure is "skip this book and keep
// going"; this is "stop everything now" — used when the picker is moving
// (destroying) source files because the move->copy patch isn't applied.
// Carries a user-facing message; dev remediation is logged separately.
class FatalImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalImportError";
  }
}

// Get the audiobooks storage directory
async function getAudiobooksDirectory(): Promise<string> {
  const audiobooksDir = `${FileSystem.documentDirectory}audiobooks/`;
  const dirInfo = await FileSystem.getInfoAsync(audiobooksDir);

  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(audiobooksDir, { intermediates: true });
  }

  return audiobooksDir;
}

// Create a directory for a specific book
async function createBookDirectory(bookId: number): Promise<string> {
  const audiobooksDir = await getAudiobooksDirectory();
  const bookDir = `${audiobooksDir}book_${bookId}/`;
  const dirInfo = await FileSystem.getInfoAsync(bookDir);

  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(bookDir, { intermediates: true });
  }

  return bookDir;
}

function isAudioFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isCoverImage(filename: string): boolean {
  if (!isImageFile(filename)) return false;
  const lower = filename.toLowerCase();
  const nameWithoutExt = lower.substring(0, lower.lastIndexOf("."));
  return COVER_FILENAMES.some((name) => nameWithoutExt === name || nameWithoutExt.startsWith(name));
}

// Extract the final, human-readable segment of a file path or SAF URI.
// SAF document URIs look like
//   content://com.android.externalstorage.documents/tree/primary%3ABooks/document/primary%3ABooks%2FThe%20Hobbit
// where the real path lives in the part after "/document/" and its separators
// are percent-encoded (%2F). We must decode *before* splitting, and drop the
// "primary:" volume prefix, otherwise the name comes out as "primary:Books/The Hobbit".
function lastUriSegment(uri: string): string {
  let s = uri;
  const docMarker = "/document/";
  const docIdx = s.lastIndexOf(docMarker);
  if (docIdx !== -1) {
    s = s.substring(docIdx + docMarker.length);
  }
  try {
    s = decodeURIComponent(s);
  } catch {
    // Keep as-is if it isn't valid percent-encoding.
  }
  s = s.replace(/\/+$/, "");
  const slash = s.lastIndexOf("/");
  if (slash !== -1) {
    // A real leaf segment never carries the "volume:" prefix, and may
    // legitimately contain a colon (e.g. "Vol 1: The Hobbit") — keep it intact.
    s = s.substring(slash + 1);
  } else {
    // No slash: a tree-root document id like "primary:Books". Strip only the
    // leading volume prefix (volume ids never contain a colon themselves).
    const colon = s.indexOf(":");
    if (colon !== -1) s = s.substring(colon + 1);
  }
  return s;
}

export function getBookTitleFromPath(path: string): string {
  const seg = lastUriSegment(path);
  if (!seg) return "Unknown Book";
  if (AUDIO_EXTENSIONS.some((ext) => seg.toLowerCase().endsWith(ext))) {
    const dotIndex = seg.lastIndexOf(".");
    return dotIndex > 0 ? seg.substring(0, dotIndex) : seg;
  }
  return seg;
}

function getChapterTitleFromFilename(filename: string): string {
  // Decode URI components
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    // Keep original if decoding fails
  }
  const dotIndex = decoded.lastIndexOf(".");
  if (dotIndex > 0) {
    return decoded.substring(0, dotIndex);
  }
  return decoded;
}

function getParentDirectory(uri: string): string {
  // Remove trailing slash if present
  const cleanUri = uri.endsWith("/") ? uri.slice(0, -1) : uri;
  const lastSlashIndex = cleanUri.lastIndexOf("/");
  if (lastSlashIndex > 0) {
    return cleanUri.substring(0, lastSlashIndex);
  }
  return cleanUri;
}

function getFolderName(uri: string): string {
  return lastUriSegment(uri) || uri;
}

// Join a child name onto a directory URI.
//
// `pickDirectory` returns a percent-encoded file:// URI that ends with a
// slash (e.g. ".../File%20Provider%20Storage/Books/"), while
// FileSystem.readDirectoryAsync returns *decoded* names ("Take Me to Your
// Leader.m4b"). Naively doing `${dir}/${name}` produced a double slash and a
// mixed-encoding path that expo-file-system can't read ("is not readable").
// Strip trailing slashes from the base and percent-encode the appended
// segment so the whole URI stays consistently encoded — which is what the
// expo-file-system calls (getInfoAsync/readDirectoryAsync/copyAsync) expect.
function joinUri(baseUri: string, segment: string): string {
  return `${baseUri.replace(/\/+$/, "")}/${encodeURIComponent(segment)}`;
}

function sanitizeFilename(filename: string): string {
  // Remove or replace characters that might cause issues
  return filename.replace(/[<>:"/\\|?*]/g, "_");
}

async function getUniqueFilename(directory: string, filename: string): Promise<string> {
  const sanitized = sanitizeFilename(filename);
  let destUri = `${directory}${sanitized}`;

  // Check if file already exists
  const info = await FileSystem.getInfoAsync(destUri);
  if (!info.exists) {
    return sanitized;
  }

  // File exists, need to find a unique name
  const dotIndex = sanitized.lastIndexOf(".");
  const baseName = dotIndex > 0 ? sanitized.substring(0, dotIndex) : sanitized;
  const extension = dotIndex > 0 ? sanitized.substring(dotIndex) : "";

  let counter = 1;
  while (true) {
    const newFilename = `${baseName}_${counter}${extension}`;
    destUri = `${directory}${newFilename}`;
    const checkInfo = await FileSystem.getInfoAsync(destUri);
    if (!checkInfo.exists) {
      return newFilename;
    }
    counter++;
    // Safety limit to prevent infinite loop
    if (counter > 1000) {
      throw new Error(`Unable to find unique filename for ${filename}`);
    }
  }
}

// @react-native-documents/picker is a native TurboModule, used only by the
// iOS folder picker. We load it lazily instead of with a top-level import so
// that a dev client built before this dependency was added (or any binary/JS
// version skew) degrades to "iOS folder picking unavailable" rather than
// throwing at module-eval time — which would take down every screen that
// transitively imports this file (the home route does). Android never calls
// it (it uses StorageAccessFramework), so on Android this is never invoked.
type DocumentPickerModule = typeof import("@react-native-documents/picker");

function loadDocumentPicker(): DocumentPickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-documents/picker");
  } catch (e) {
    console.warn(
      "@react-native-documents/picker native module unavailable — rebuild the dev client (npx expo run:ios). iOS folder picking is disabled.",
      e
    );
    return null;
  }
}

export async function pickAudiobooksFolder(): Promise<PickResult | null> {
  try {
    if (Platform.OS === "android" && StorageAccessFramework) {
      // Android: Use Storage Access Framework for proper directory access
      const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();

      if (!permissions.granted) {
        return null;
      }

      const folderUri = permissions.directoryUri;
      const folderName = getFolderName(decodeURIComponent(folderUri));

      // Android SAF grants are persistent through the URI itself — no
      // bookmark needed.
      return { folderUri, folderName, bookmark: null };
    }

    // iOS: real directory picker (UIDocumentPickerViewController for opening
    // a folder). Unlike the old "pick a file, guess the parent" hack, this
    // grants access to the whole folder tree — so a folder containing both a
    // loose audio file and a sub-folder of chapters imports as two books.
    //
    // requestLongTermAccess keeps the iOS security scope held for the app
    // process (not just this module) after the picker returns, so the
    // expo-file-system scan in scanAndImportFolder can read the tree. We
    // copy everything into app storage during that scan; we never persist
    // the bookmark, and we never explicitly release the scope (doing so
    // crashes the app — see scanAndImportFolder). iOS reclaims the
    // process-scoped handle automatically when the process exits.
    const picker = loadDocumentPicker();
    if (!picker) {
      return null;
    }

    try {
      // Use the library's default presentation (pageSheet). Forcing
      // "fullScreen" on UIDocumentPickerViewController (an out-of-process
      // remote view controller) is a known cause of the host app being
      // terminated when the picker is dismissed.
      const result = await picker.pickDirectory({
        requestLongTermAccess: true,
      });

      let bookmark: string | null = null;
      if ("bookmarkStatus" in result) {
        if (result.bookmarkStatus === "success") {
          bookmark = result.bookmark;
        } else {
          // No long-term bookmark, but the transient scope from the pick is
          // still active — enough for the immediate scan-and-copy below.
          // Future sync passes won't be able to re-scan this source.
          console.warn("pickDirectory bookmark error:", result.bookmarkError);
        }
      }

      const folderUri = result.uri;
      const folderName = getFolderName(decodeURIComponent(folderUri));

      return { folderUri, folderName, bookmark };
    } catch (error) {
      if (
        picker.isErrorWithCode(error) &&
        error.code === picker.errorCodes.OPERATION_CANCELED
      ) {
        return null;
      }
      throw error;
    }
  } catch (error) {
    console.error("Error picking folder:", error);
    return null;
  }
}

export async function scanAndImportFolder(folderUri: string): Promise<ImportResult> {
  try {
    // Check if this is an Android SAF URI
    const isAndroidSAF = Platform.OS === "android" && folderUri.startsWith("content://");

    if (isAndroidSAF && StorageAccessFramework) {
      return await scanAndImportSAFFolder(folderUri);
    }

    // iOS: scan + copy the picked directory tree into app storage while the
    // security scope from pickDirectory is still held. The copies are what
    // playback uses, so the original location isn't needed afterward.
    //
    // We deliberately do NOT call picker.releaseSecureAccess() here. In
    // @react-native-documents/picker 12.0.1 that native call
    // (stopAccessingOpenedUrls -> stopAccessingSecurityScopedResource on the
    // File Provider directory URL, run off the main thread under the New
    // Architecture) hard-crashes the app with no JS error — and a native
    // crash can't be caught by a JS try/catch. It only fires AFTER the
    // scan+copy has fully completed, which is why imported books still show
    // up on the next launch. Since every file is already copied into the app
    // sandbox and we never persist the long-term bookmark, the security
    // scope is throwaway: iOS reclaims it automatically when the process
    // exits. Skipping the release leaks one process-scoped handle per import
    // (harmless for occasional imports) and removes the crash.
    const res = await scanAndImportLocalFolder(folderUri);
    return res;
  } catch (error) {
    if (error instanceof FatalImportError) {
      // Already aborted to protect the user's files; show its message as-is
      // (no "Error scanning folder:" prefix — it's a user-facing sentence).
      console.error("Import aborted (fatal):", error.message);
      return { success: false, booksImported: 0, message: error.message };
    }
    console.error("Error scanning folder:", error);
    return { success: false, booksImported: 0, message: `Error scanning folder: ${getErrorMessage(error)}` };
  }
}

// Android SAF scanning
async function scanAndImportSAFFolder(folderUri: string): Promise<ImportResult> {
  let booksImported = 0;

  // Use SAF to read directory contents - returns array of URIs
  const contentUris = await StorageAccessFramework.readDirectoryAsync(folderUri);

  const audioFiles: ScannedFile[] = [];
  const imageFiles: ScannedFile[] = [];
  const subdirectories: string[] = [];

  for (const itemUri of contentUris) {
    // Decode the URI to get the filename
    const decodedUri = decodeURIComponent(itemUri);
    const filename = getFilenameFromUri(decodedUri);

    // Check if it's an audio file first
    if (isAudioFile(filename)) {
      audioFiles.push({ name: filename, uri: itemUri });
    } else if (isImageFile(filename)) {
      imageFiles.push({ name: filename, uri: itemUri });
    } else {
      // Try to read as directory - if it works, it's a directory
      try {
        await StorageAccessFramework.readDirectoryAsync(itemUri);
        subdirectories.push(itemUri);
      } catch {
        // Not a directory and not an audio file, skip it
      }
    }
  }

  // Find a cover image for the root folder (for single-file books)
  const rootCoverUri = findCoverImage(imageFiles);

  // If there are subdirectories, treat each as a potential book (folder with chapters)
  for (const subdir of subdirectories) {
    const imported = await importBookFromSAFDirectory(subdir);
    if (imported) booksImported++;
  }

  // Each loose audio file in the root is a separate single-file book
  for (const audioFile of audioFiles) {
    const imported = await importSingleFile(audioFile, folderUri, rootCoverUri, safResolver);
    if (imported) booksImported++;
  }

  if (booksImported === 0) {
    return { success: false, booksImported: 0, message: "No audiobooks found in the selected location" };
  }

  return {
    success: true,
    booksImported,
    message: `Successfully imported ${booksImported} book${booksImported === 1 ? "" : "s"}`,
  };
}

// Find a cover image from a list of image files
function findCoverImage(imageFiles: ScannedFile[]): string | null {
  // First, look for files with common cover names
  for (const img of imageFiles) {
    if (isCoverImage(img.name)) {
      return img.uri;
    }
  }
  // Fall back to the first image file if any
  if (imageFiles.length > 0) {
    return imageFiles[0].uri;
  }
  return null;
}

// iOS/local file system scanning
async function scanAndImportLocalFolder(folderUri: string): Promise<ImportResult> {
  const dirInfo = await FileSystem.getInfoAsync(folderUri);

  if (!dirInfo.exists) {
    return { success: false, booksImported: 0, message: "Folder does not exist or is not accessible" };
  }

  if (!dirInfo.isDirectory) {
    // It's a single file, not a directory
    const filename = folderUri.split("/").pop() || "audio.mp3";
    if (isAudioFile(filename)) {
      const imported = await importSingleFile({ name: filename, uri: folderUri }, getParentDirectory(folderUri), null, localResolver);
      return {
        success: imported,
        booksImported: imported ? 1 : 0,
        message: imported ? "Successfully imported 1 book" : "Failed to import audiobook",
      };
    }
    return { success: false, booksImported: 0, message: "Selected file is not an audio file" };
  }

  let booksImported = 0;

  // List contents of the directory
  const contents = await FileSystem.readDirectoryAsync(folderUri);

  const audioFiles: ScannedFile[] = [];
  const imageFiles: ScannedFile[] = [];
  const subdirectories: string[] = [];

  for (const item of contents) {
    const itemUri = joinUri(folderUri, item);
    const itemInfo = await FileSystem.getInfoAsync(itemUri);

    if (itemInfo.isDirectory) {
      subdirectories.push(itemUri);
    } else if (isAudioFile(item)) {
      audioFiles.push({ name: item, uri: itemUri });
    } else if (isImageFile(item)) {
      imageFiles.push({ name: item, uri: itemUri });
    }
  }

  // Find a cover image for the root folder
  const rootCoverUri = findCoverImage(imageFiles);

  // If there are subdirectories, treat each as a potential book
  for (const subdir of subdirectories) {
    const imported = await importBookFromLocalDirectory(subdir);
    if (imported) booksImported++;
  }

  // Each loose audio file in the root is a separate single-file book
  for (const audioFile of audioFiles) {
    const imported = await importSingleFile(audioFile, folderUri, rootCoverUri, localResolver);
    if (imported) booksImported++;
  }

  if (booksImported === 0) {
    return { success: false, booksImported: 0, message: "No audiobooks found in the selected location" };
  }

  return {
    success: true,
    booksImported,
    message: `Successfully imported ${booksImported} book${booksImported === 1 ? "" : "s"}`,
  };
}

function getFilenameFromUri(uri: string): string {
  // Handle empty or invalid input
  if (!uri || typeof uri !== "string") {
    return "";
  }

  // SAF URIs have the filename after the last %2F or /
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // If decoding fails, use the original URI
    decoded = uri;
  }

  // Remove trailing slashes and split
  const trimmed = decoded.replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split(/[/]/);
  const filename = parts[parts.length - 1];

  // Return empty string if filename is undefined, null, or empty
  return filename?.trim() || "";
}

async function copyFileLocal(
  sourceUri: string,
  bookId: number,
  filename: string
): Promise<string> {
  const bookDir = await createBookDirectory(bookId);
  const safeFilename = await getUniqueFilename(bookDir, filename);
  const destUri = `${bookDir}${safeFilename}`;

  // The source lives in a security-scoped File Provider location (the picked
  // directory tree). expo-file-system doesn't own that scope, so reading it
  // with copyAsync fails on small files and silently kills the app (iOS
  // Jetsam) on large ones. keepLocalCopy does the read inside the picker's
  // native module — which holds the long-term scope and materializes iCloud
  // / File Provider files — dropping it in app storage. We then move that
  // into the book folder: a cheap in-sandbox rename that needs no scope.
  //
  // CRITICAL: upstream @react-native-documents/picker implements
  // keepLocalCopy with FileManager.moveItem — it DELETES the source. Our
  // source is the user's real file in the picked folder ("On My iPhone"),
  // not a throwaway picker-inbox file, so a move destroys their library.
  // patches/@react-native-documents+picker+12.0.1.patch swaps moveItem ->
  // copyItem. The post-copy existence check below is the backstop: if the
  // patch ever falls off (fresh clone without postinstall, version bump),
  // we abort loudly after the first file instead of silently wiping the
  // rest of the user's folder.
  const picker = loadDocumentPicker();
  if (!picker) {
    throw new Error("Document picker unavailable; cannot import audiobook file.");
  }

  // Unique transient name in Documents so a duplicate basename or leftover
  // from an earlier failed run can't collide before the move consumes it.
  const tempName = `import_${bookId}_${Date.now()}_${sanitizeFilename(filename)}`;
  const [copied] = await picker.keepLocalCopy({
    destination: "documentDirectory",
    files: [{ uri: sourceUri, fileName: tempName }],
  });

  if (copied.status !== "success") {
    throw new Error(`keepLocalCopy failed for ${filename}: ${copied.copyError}`);
  }

  // Backstop against the move-not-copy bug (see comment above): did the
  // source survive?
  const sourceSurvived = (await FileSystem.getInfoAsync(sourceUri)).exists;

  // Always move the materialized file into the book folder FIRST. In the
  // normal (patched) case this is the intended copy. In the destructive
  // (unpatched) case the source is already gone, so copied.localUri is the
  // user's ONLY remaining copy — discarding it (e.g. as cleanup) would
  // complete the data loss this backstop exists to prevent. Preserving it
  // keeps that one book playable; we still abort below so the REST of the
  // folder isn't destroyed.
  await FileSystem.moveAsync({ from: copied.localUri, to: destUri });

  if (!sourceSurvived) {
    // Dev-facing remediation — logged, never shown to users.
    console.error(
      `keepLocalCopy MOVED instead of copied "${filename}": the ` +
        `@react-native-documents/picker move->copy patch is not applied. ` +
        `Run "npx patch-package" then rebuild native ` +
        `("npx pod-install ios && npx expo run:ios").`
    );
    // User-facing, actionable, no internal jargon. FatalImportError aborts
    // the whole scan so no further source files are destroyed.
    throw new FatalImportError(
      "Import stopped to protect your files. Please update to the latest " +
        "version of the app, then try importing again."
    );
  }

  return destUri;
}

// Resolves a source file URI to a playable URI.
// SAF (Android): uses the content:// URI directly — SAF permissions are
// persistent and the player can stream from content:// URIs, so no copy.
// Local (iOS): copies the file to app storage.
type FileResolver = (sourceUri: string, bookId: number, filename: string) => Promise<string>;

const safResolver: FileResolver = async (sourceUri) => sourceUri;
const localResolver: FileResolver = async (sourceUri, bookId, filename) =>
  copyFileLocal(sourceUri, bookId, filename);

// Roll back a book whose chapters couldn't be fully inserted, so a failed or
// partial import never leaves an orphan (a book row with missing chapters
// that renders broken in the library). deleteBook cascades to chapters
// (FK ON DELETE CASCADE); deleteBookFiles clears any iOS copies.
async function cleanupFailedBook(bookId: number): Promise<void> {
  try {
    await deleteBook(bookId);
  } catch (e) {
    console.warn("Failed to roll back partial book:", e);
  }
  await deleteBookFiles(bookId).catch(() => {});
}

// Decide and persist a book's cover, in priority order:
//   1. a sidecar image (cover.jpg / folder.png …) found next to the audio —
//      copied into app storage on iOS via the resolver so it survives after
//      the picked-folder security scope is gone; left as the persistent
//      content:// URI on Android SAF.
//   2. artwork embedded in the first audio file's metadata (single-file m4b
//      etc.) — only extractable from range-readable file:// URIs.
//   3. nothing — the book shows the placeholder icon until the user picks a
//      cover from the internet.
//
// Best effort: a non-fatal cover problem must never fail an otherwise-good
// import, so those errors are swallowed. The one exception is FatalImportError
// — copyFileLocal's move-not-copy backstop, which means the picker is
// destroying the user's source files. That MUST abort the whole scan, so it
// is rethrown rather than relying on the assumption that it can't reach here.
async function resolveBookCover(
  bookId: number,
  sidecarUri: string | null,
  firstAudioLocalUri: string | null,
  resolveFile: FileResolver,
): Promise<void> {
  let cover: string | null = null;

  if (sidecarUri) {
    try {
      const ext = imageExtFromName(sidecarUri) ?? "jpg";
      cover = await resolveFile(sidecarUri, bookId, `cover_${Date.now()}.${ext}`);
    } catch (e) {
      if (e instanceof FatalImportError) throw e;
      console.warn("Could not store sidecar cover; trying embedded art:", e);
      cover = null;
    }
  }

  if (!cover && firstAudioLocalUri) {
    cover = await extractEmbeddedCover(firstAudioLocalUri, bookId);
  }

  if (cover) {
    try {
      await updateBookCover(bookId, cover);
    } catch (e) {
      console.warn("Failed to persist book cover:", e);
    }
  }
}

async function importBookFromDirectory(
  audioFiles: ScannedFile[],
  imageFiles: ScannedFile[],
  directoryUri: string,
  titleSource: string,
  resolveFile: FileResolver,
): Promise<boolean> {
  try {
    if (await bookExistsAtPath(directoryUri)) {
      return false;
    }

    audioFiles.sort((a, b) => naturalCompare(a.sortKey ?? a.name, b.sortKey ?? b.name));

    if (audioFiles.length === 0) {
      return false;
    }

    const coverUri = findCoverImage(imageFiles);
    const title = getBookTitleFromPath(titleSource);
    console.log(`Importing book: ${title} with ${audioFiles.length} chapters`);

    // Cover is resolved after chapters land (it may need the copied audio
    // file to read embedded art), so don't store the raw sidecar URI here.
    const bookId = await insertBook(title, directoryUri, undefined, undefined);

    let firstAudioLocalUri: string | null = null;
    try {
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const chapterTitle = getChapterTitleFromFilename(file.name);
        const localUri = await resolveFile(file.uri, bookId, file.name);
        if (i === 0) firstAudioLocalUri = localUri;
        await insertChapter(bookId, chapterTitle, localUri, i);
      }
    } catch (error) {
      // A fatal condition (picker destroying sources) must abort the whole
      // scan — and must NOT run cleanupFailedBook, which would delete the
      // book folder holding the only surviving copy of the moved file.
      if (error instanceof FatalImportError) throw error;
      // A chapter file is already imported (chapters.file_path is globally
      // UNIQUE) or a file couldn't be copied. Roll back so we don't leave a
      // half-imported book, and skip it rather than spamming an error.
      console.warn(`Skipping "${title}" — could not import all chapters:`, error);
      await cleanupFailedBook(bookId);
      return false;
    }

    await resolveBookCover(bookId, coverUri, firstAudioLocalUri, resolveFile);

    return true;
  } catch (error) {
    if (error instanceof FatalImportError) throw error;
    console.error("Error importing book from directory:", error);
    return false;
  }
}

async function importSingleFile(
  file: ScannedFile,
  originalFolderUri: string,
  coverUri: string | null,
  resolveFile: FileResolver,
): Promise<boolean> {
  try {
    // Synthetic DB key (books.folder_path) for a loose file. This is a dedupe
    // key only — never read from disk — so it must NOT be percent-encoded or
    // otherwise reformatted: changing its shape makes bookExistsAtPath miss
    // books imported by older builds and re-import them, colliding on the
    // globally-UNIQUE chapters.file_path. (The real, readable source URI is
    // file.uri, built correctly via joinUri during the scan.)
    //
    // Strip trailing slashes first: the iOS pickDirectory URI ends with "/",
    // and older builds derived this base via getParentDirectory (no trailing
    // slash). Without trimming we'd produce ".../Books//file.m4b" and miss
    // those previously imported books. Trimming is shape-preserving (older
    // builds never had the trailing slash); percent-encoding is still avoided.
    const uniquePath = `${originalFolderUri.replace(/\/+$/, "")}/${file.name}`;

    if (await bookExistsAtPath(uniquePath)) {
      return false;
    }

    const title = getChapterTitleFromFilename(file.name);
    console.log(`Importing single file book: ${title}`);

    const bookId = await insertBook(title, uniquePath, undefined, undefined);
    let localUri: string;
    try {
      localUri = await resolveFile(file.uri, bookId, file.name);
      await insertChapter(bookId, title, localUri, 0);
    } catch (error) {
      if (error instanceof FatalImportError) throw error;
      // File already imported (chapters.file_path UNIQUE) or unreadable —
      // roll back the just-created book so it isn't left orphaned, and skip.
      console.warn(`Skipping "${title}" — could not import file:`, error);
      await cleanupFailedBook(bookId);
      return false;
    }

    // Single-file books rarely have a sidecar image; the cover usually lives
    // *inside* the file (m4b/mp3 metadata) — extractEmbeddedCover handles that.
    await resolveBookCover(bookId, coverUri, localUri, resolveFile);

    return true;
  } catch (error) {
    if (error instanceof FatalImportError) throw error;
    console.error("Error importing single file book:", error);
    return false;
  }
}

// Recursively collect every audio/image file under an Android SAF directory.
// A book folder can be arbitrarily nested (Book/CD1/.., Book/CD2/..); we walk
// it the way Voice's ChapterParser.parseChapters does.
async function walkSAFTree(
  directoryUri: string,
  depth = 0,
  relPrefix = "",
): Promise<{ audioFiles: ScannedFile[]; imageFiles: ScannedFile[] }> {
  const audioFiles: ScannedFile[] = [];
  const imageFiles: ScannedFile[] = [];
  if (depth > MAX_SCAN_DEPTH) return { audioFiles, imageFiles };

  const contentUris = await StorageAccessFramework.readDirectoryAsync(directoryUri);
  for (const uri of contentUris) {
    const filename = getFilenameFromUri(uri);
    const rel = relPrefix ? `${relPrefix}/${filename}` : filename;

    if (isAudioFile(filename)) {
      audioFiles.push({ name: filename, uri, sortKey: rel });
    } else if (isImageFile(filename)) {
      imageFiles.push({ name: filename, uri, sortKey: rel });
    } else if (
      COMPANION_FILE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))
    ) {
      // Known non-directory companion file — skip the costly SAF probe.
    } else {
      // Unknown entry — probe whether it's a subdirectory and recurse.
      try {
        const sub = await walkSAFTree(uri, depth + 1, rel);
        audioFiles.push(...sub.audioFiles);
        imageFiles.push(...sub.imageFiles);
      } catch {
        // Not a directory; skip.
      }
    }
  }
  return { audioFiles, imageFiles };
}

// Recursively collect every audio/image file under a local (iOS) directory.
async function walkLocalTree(
  directoryUri: string,
  depth = 0,
  relPrefix = "",
): Promise<{ audioFiles: ScannedFile[]; imageFiles: ScannedFile[] }> {
  const audioFiles: ScannedFile[] = [];
  const imageFiles: ScannedFile[] = [];
  if (depth > MAX_SCAN_DEPTH) return { audioFiles, imageFiles };

  const contents = await FileSystem.readDirectoryAsync(directoryUri);
  for (const item of contents) {
    const itemUri = joinUri(directoryUri, item);
    const rel = relPrefix ? `${relPrefix}/${item}` : item;
    const info = await FileSystem.getInfoAsync(itemUri);

    if (info.isDirectory) {
      const sub = await walkLocalTree(itemUri, depth + 1, rel);
      audioFiles.push(...sub.audioFiles);
      imageFiles.push(...sub.imageFiles);
    } else if (isAudioFile(item)) {
      audioFiles.push({ name: item, uri: itemUri, sortKey: rel });
    } else if (isImageFile(item)) {
      imageFiles.push({ name: item, uri: itemUri, sortKey: rel });
    }
  }
  return { audioFiles, imageFiles };
}

// Sync helper: list every audio file under a SAF book folder (recursively).
// `uri` matches exactly what import stores in chapters.file_path for SAF books,
// so the result can be diffed against the DB.
export async function collectSAFBookFiles(
  directoryUri: string,
): Promise<{ uri: string; name: string; sortKey: string }[]> {
  const { audioFiles } = await walkSAFTree(directoryUri);
  return audioFiles.map((f) => ({
    uri: f.uri,
    name: f.name,
    sortKey: f.sortKey ?? f.name,
  }));
}

export { getChapterTitleFromFilename };

// Sync helper (iOS): list every top-level book that currently exists under a
// local picked folder, in the exact `folder_path` form the import path writes
// to books.folder_path. Lets sync diff this against the DB to find books whose
// source was deleted.
//
// Subdirectory book: `folder_path = joinUri(folderUri, item)` — percent-encoded,
//   matches importBookFromLocalDirectory.
// Loose-file book:   `folder_path = "${folderUri.replace(/\/+$/,'')}/${item}"`
//   — NOT percent-encoded, matches importSingleFile.
//
// Returns null (NOT an empty set) when the folder can't be listed — caller
// must skip the deletion pass in that case, because treating "unreadable" as
// "empty" would mark every book under this source as missing and wipe them.
// Caller must already hold any security scope needed to read the folder.
export async function collectLocalBookFolderPaths(
  folderUri: string,
): Promise<Set<string> | null> {
  let dirInfo;
  try {
    dirInfo = await FileSystem.getInfoAsync(folderUri);
  } catch {
    return null;
  }
  if (!dirInfo.exists || !dirInfo.isDirectory) {
    return null;
  }

  let contents: string[];
  try {
    contents = await FileSystem.readDirectoryAsync(folderUri);
  } catch {
    return null;
  }

  const expected = new Set<string>();
  const trimmedFolderUri = folderUri.replace(/\/+$/, "");

  for (const item of contents) {
    const itemUri = joinUri(folderUri, item);
    let itemInfo;
    try {
      itemInfo = await FileSystem.getInfoAsync(itemUri);
    } catch {
      continue;
    }
    if (itemInfo.isDirectory) {
      expected.add(itemUri);
    } else if (isAudioFile(item)) {
      expected.add(`${trimmedFolderUri}/${item}`);
    }
  }
  return expected;
}

async function importBookFromSAFDirectory(directoryUri: string): Promise<boolean> {
  try {
    const { audioFiles, imageFiles } = await walkSAFTree(directoryUri);
    return importBookFromDirectory(audioFiles, imageFiles, directoryUri, directoryUri, safResolver);
  } catch (error) {
    console.error("Error importing book from SAF directory:", error);
    return false;
  }
}

async function importBookFromLocalDirectory(directoryUri: string): Promise<boolean> {
  try {
    if (await bookExistsAtPath(directoryUri)) {
      return false;
    }

    const { audioFiles, imageFiles } = await walkLocalTree(directoryUri);

    return importBookFromDirectory(audioFiles, imageFiles, directoryUri, directoryUri, localResolver);
  } catch (error) {
    if (error instanceof FatalImportError) throw error;
    console.error("Error importing book from local directory:", error);
    return false;
  }
}

// Clean up copied files for a deleted book (iOS only)
// Note: This only removes files from the app's private storage.
// Original source files are NEVER deleted - only the copies made during import.
// On Android (SAF), files are played directly from source and not copied,
// so this function has no effect.
export async function deleteBookFiles(bookId: number): Promise<void> {
  try {
    const audiobooksDir = await getAudiobooksDirectory();
    const bookDir = `${audiobooksDir}book_${bookId}/`;
    const dirInfo = await FileSystem.getInfoAsync(bookDir);

    if (dirInfo.exists) {
      await FileSystem.deleteAsync(bookDir, { idempotent: true });
    }
  } catch (error) {
    console.error("Error deleting book files:", error);
  }
}
