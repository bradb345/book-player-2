import * as FileSystem from "expo-file-system/legacy";
import { StorageAccessFramework } from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import {
  insertBook,
  insertChapter,
  bookExistsAtPath,
} from "./database";

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg"];
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
}

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

function getBookTitleFromPath(path: string): string {
  const parts = path.split("/");
  const lastPart = parts[parts.length - 1] || parts[parts.length - 2] || "Unknown Book";
  // Remove extension if it's a file
  const dotIndex = lastPart.lastIndexOf(".");
  if (dotIndex > 0 && AUDIO_EXTENSIONS.some((ext) => lastPart.toLowerCase().endsWith(ext))) {
    return decodeURIComponent(lastPart.substring(0, dotIndex));
  }
  // Decode URI components for folder names
  try {
    return decodeURIComponent(lastPart) || "Unknown Book";
  } catch {
    return lastPart || "Unknown Book";
  }
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
  const cleanUri = uri.endsWith("/") ? uri.slice(0, -1) : uri;
  const parts = cleanUri.split("/");
  const name = parts[parts.length - 1];
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function sanitizeFilename(filename: string): string {
  // Remove or replace characters that might cause issues
  return filename.replace(/[<>:"/\\|?*]/g, "_");
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
    return { success: false, booksImported: 0, message: `Error scanning folder: ${error}` };
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
    const imported = await importSingleFileBook(audioFile, folderUri, rootCoverUri);
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
      const imported = await importSingleFileBookLocal({ name: filename, uri: folderUri }, getParentDirectory(folderUri), null);
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
    const imported = await importSingleFileBookLocal(audioFile, folderUri, rootCoverUri);
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
  // SAF URIs have the filename after the last %2F or /
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split(/[/]/);
  return parts[parts.length - 1] || "";
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
  const safeFilename = sanitizeFilename(filename);
  const destUri = `${bookDir}${safeFilename}`;

  console.log(`Copying file from ${sourceUri} to ${destUri}`);

  await FileSystem.copyAsync({
    from: sourceUri,
    to: destUri,
  });

  console.log(`File copied successfully to ${destUri}`);
  return destUri;
}

async function importBookFromSAFDirectory(directoryUri: string): Promise<boolean> {
  try {
    // Check if already imported
    if (await bookExistsAtPath(directoryUri)) {
      console.log("Book already exists:", directoryUri);
      return false;
    }

    // Use SAF to read directory contents
    const contentUris = await StorageAccessFramework.readDirectoryAsync(directoryUri);

    const audioFiles: ScannedFile[] = [];
    const imageFiles: ScannedFile[] = [];
    for (const uri of contentUris) {
      const filename = getFilenameFromUri(decodeURIComponent(uri));
      if (isAudioFile(filename)) {
        audioFiles.push({ name: filename, uri });
      } else if (isImageFile(filename)) {
        imageFiles.push({ name: filename, uri });
      }
    }

    // Sort by filename
    audioFiles.sort((a, b) => naturalSort(a.name, b.name));

    if (audioFiles.length === 0) {
      return false;
    }

    // Find cover image in this directory
    const coverUri = findCoverImage(imageFiles);

    const title = getBookTitleFromPath(decodeURIComponent(directoryUri));
    console.log(`Importing book: ${title} with ${audioFiles.length} chapters`);

    const bookId = await insertBook(title, directoryUri, undefined, coverUri || undefined);

    // Create chapter entries using SAF URIs directly
    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const chapterTitle = getChapterTitleFromFilename(file.name);
      const localUri = getFileUriForSAF(file.uri);
      await insertChapter(bookId, chapterTitle, localUri, i);
    }

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
    console.error("Error importing book from SAF directory:", error);
    return false;
  }
}

async function importSingleFileBook(file: ScannedFile, originalFolderUri: string, coverUri: string | null): Promise<boolean> {
  try {
    const uniquePath = `${originalFolderUri}/${file.name}`;

    // Check if already imported
    if (await bookExistsAtPath(uniquePath)) {
      console.log("Book already exists:", uniquePath);
      return false;
    }

    const title = getChapterTitleFromFilename(file.name);
    console.log(`Importing single file book: ${title}`);

    const bookId = await insertBook(title, uniquePath, undefined, coverUri || undefined);

    // Use SAF URI directly (no copying needed)
    const localUri = getFileUriForSAF(file.uri);

    await insertChapter(bookId, title, localUri, 0);

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
    console.error("Error importing single file book:", error);
    return false;
  }
}

async function importMultiFileBookFromSAF(folderUri: string, files: ScannedFile[]): Promise<boolean> {
  try {
    // Check if already imported
    if (await bookExistsAtPath(folderUri)) {
      console.log("Book already exists:", folderUri);
      return false;
    }

    const sortedFiles = [...files].sort((a, b) => naturalSort(a.name, b.name));
    const title = getBookTitleFromPath(decodeURIComponent(folderUri));
    console.log(`Importing multi-file book: ${title} with ${sortedFiles.length} chapters`);

    const bookId = await insertBook(title, folderUri);

    // Copy each audio file and create chapter entries
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const chapterTitle = getChapterTitleFromFilename(file.name);

      // Use SAF URI directly (no copying needed)
      const localUri = getFileUriForSAF(file.uri);

      await insertChapter(bookId, chapterTitle, localUri, i);
    }

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
    console.error("Error importing multi-file book:", error);
    return false;
  }
}

// Local file system import functions (for iOS)
async function importBookFromLocalDirectory(directoryUri: string): Promise<boolean> {
  try {
    // Check if already imported
    if (await bookExistsAtPath(directoryUri)) {
      console.log("Book already exists:", directoryUri);
      return false;
    }

    const contents = await FileSystem.readDirectoryAsync(directoryUri);

    const audioFiles = contents
      .filter(isAudioFile)
      .sort(naturalSort)
      .map((name) => ({ name, uri: `${directoryUri}/${name}` }));

    const imageFiles = contents
      .filter(isImageFile)
      .map((name) => ({ name, uri: `${directoryUri}/${name}` }));

    if (audioFiles.length === 0) {
      return false;
    }

    // Find cover image in this directory
    const coverUri = findCoverImage(imageFiles);

    const title = getBookTitleFromPath(directoryUri);
    console.log(`Importing book: ${title} with ${audioFiles.length} chapters`);

    const bookId = await insertBook(title, directoryUri, undefined, coverUri || undefined);

    // Copy each audio file and create chapter entries
    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const chapterTitle = getChapterTitleFromFilename(file.name);

      // Copy file to app storage
      const localUri = await copyFileLocal(file.uri, bookId, file.name);

      await insertChapter(bookId, chapterTitle, localUri, i);
    }

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
    console.error("Error importing book from local directory:", error);
    return false;
  }
}

async function importSingleFileBookLocal(file: ScannedFile, originalFolderUri: string, coverUri: string | null): Promise<boolean> {
  try {
    const uniquePath = `${originalFolderUri}/${file.name}`;

    // Check if already imported
    if (await bookExistsAtPath(uniquePath)) {
      console.log("Book already exists:", uniquePath);
      return false;
    }

    const title = getChapterTitleFromFilename(file.name);
    console.log(`Importing single file book: ${title}`);

    const bookId = await insertBook(title, uniquePath, undefined, coverUri || undefined);

    // Copy file to app storage
    const localUri = await copyFileLocal(file.uri, bookId, file.name);

    await insertChapter(bookId, title, localUri, 0);

    console.log(`Book imported successfully: ${title}`);
    return true;
  } catch (error) {
    console.error("Error importing single file book:", error);
    return false;
  }
}

// Clean up files for a deleted book
export async function deleteBookFiles(bookId: number): Promise<void> {
  try {
    const audiobooksDir = await getAudiobooksDirectory();
    const bookDir = `${audiobooksDir}book_${bookId}/`;
    const dirInfo = await FileSystem.getInfoAsync(bookDir);

    if (dirInfo.exists) {
      await FileSystem.deleteAsync(bookDir, { idempotent: true });
      console.log(`Deleted book files: ${bookDir}`);
    }
  } catch (error) {
    console.error("Error deleting book files:", error);
  }
}
