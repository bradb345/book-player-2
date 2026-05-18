import * as FileSystem from "expo-file-system/legacy";
import { StorageAccessFramework } from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import {
  insertBook,
  insertChapter,
  bookExistsAtPath,
} from "./database";

export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const COVER_FILENAMES = ["cover", "folder", "front", "album", "artwork"];
const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/x-m4b",
  "audio/aac",
  "audio/wav",
  "audio/flac",
  "audio/ogg",
  "audio/*",
];

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
  if (slash !== -1) s = s.substring(slash + 1);
  // Tree-root document ids look like "primary:Books" — keep only the leaf.
  const colon = s.lastIndexOf(":");
  if (colon !== -1) s = s.substring(colon + 1);
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

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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

function sanitizeFilename(filename: string): string {
  // Remove or replace characters that might cause issues
  return filename.replace(/[<>:"/\\|?*]/g, "_");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

      return { folderUri, folderName };
    } else {
      // iOS: Use document picker to select an audio file, then use parent directory
      const result = await DocumentPicker.getDocumentAsync({
        type: AUDIO_MIME_TYPES,
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const fileUri = result.assets[0].uri;
      const parentDir = getParentDirectory(fileUri);
      const folderName = getFolderName(parentDir);

      return { folderUri: parentDir, folderName };
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
    } else {
      return await scanAndImportLocalFolder(folderUri);
    }
  } catch (error) {
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
    const itemUri = `${folderUri}/${item}`;
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

// For SAF URIs, we don't copy - just use the URI directly
// The SAF permissions are persistent and expo-av can play from content:// URIs
function getFileUriForSAF(sourceUri: string): string {
  return sourceUri;
}

async function copyFileLocal(
  sourceUri: string,
  bookId: number,
  filename: string
): Promise<string> {
  const bookDir = await createBookDirectory(bookId);
  const safeFilename = await getUniqueFilename(bookDir, filename);
  const destUri = `${bookDir}${safeFilename}`;

  console.log(`Copying file from ${sourceUri} to ${destUri}`);

  await FileSystem.copyAsync({
    from: sourceUri,
    to: destUri,
  });

  console.log(`File copied successfully to ${destUri}`);
  return destUri;
}

// Resolves a source file URI to a playable URI.
// SAF (Android): uses the content:// URI directly.
// Local (iOS): copies the file to app storage.
type FileResolver = (sourceUri: string, bookId: number, filename: string) => Promise<string>;

const safResolver: FileResolver = async (sourceUri) => getFileUriForSAF(sourceUri);
const localResolver: FileResolver = async (sourceUri, bookId, filename) =>
  copyFileLocal(sourceUri, bookId, filename);

async function importBookFromDirectory(
  audioFiles: ScannedFile[],
  imageFiles: ScannedFile[],
  directoryUri: string,
  titleSource: string,
  resolveFile: FileResolver,
): Promise<boolean> {
  try {
    if (await bookExistsAtPath(directoryUri)) {
      console.log("Book already exists:", directoryUri);
      return false;
    }

    audioFiles.sort((a, b) => naturalSort(a.sortKey ?? a.name, b.sortKey ?? b.name));

    if (audioFiles.length === 0) {
      return false;
    }

    const coverUri = findCoverImage(imageFiles);
    const title = getBookTitleFromPath(titleSource);
    console.log(`Importing book: ${title} with ${audioFiles.length} chapters`);

    const bookId = await insertBook(title, directoryUri, undefined, coverUri || undefined);

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const chapterTitle = getChapterTitleFromFilename(file.name);
      const localUri = await resolveFile(file.uri, bookId, file.name);
      await insertChapter(bookId, chapterTitle, localUri, i);
    }

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
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
    const uniquePath = `${originalFolderUri}/${file.name}`;

    if (await bookExistsAtPath(uniquePath)) {
      console.log("Book already exists:", uniquePath);
      return false;
    }

    const title = getChapterTitleFromFilename(file.name);
    console.log(`Importing single file book: ${title}`);

    const bookId = await insertBook(title, uniquePath, undefined, coverUri || undefined);
    const localUri = await resolveFile(file.uri, bookId, file.name);
    await insertChapter(bookId, title, localUri, 0);

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
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
    } else {
      // Not a recognized file — probe whether it's a subdirectory and recurse.
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
    const itemUri = `${directoryUri}/${item}`;
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
      console.log("Book already exists:", directoryUri);
      return false;
    }

    const { audioFiles, imageFiles } = await walkLocalTree(directoryUri);

    return importBookFromDirectory(audioFiles, imageFiles, directoryUri, directoryUri, localResolver);
  } catch (error) {
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
      console.log(`Deleted copied book files from app storage: ${bookDir}`);
    }
  } catch (error) {
    console.error("Error deleting book files:", error);
  }
}
