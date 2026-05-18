// Library sync pass — keeps the DB in step with what's actually on disk,
// modeled on Voice's MediaScanner:
//
//   • brand-new book folders get imported
//   • books whose chapter files changed get reconciled (add/remove chapters)
//     while preserving playback progress
//   • books whose folders/files vanished are marked inactive (hidden) instead
//     of deleted, so progress + history survive and they reappear if the
//     files come back
//
// Scope (prototype): the Android / SAF "no-copy" model, where chapters.file_path
// is the real source content:// URI and can be diffed against the filesystem —
// the same platform Voice targets. iOS copies files into app storage, so its
// chapters.file_path points at the copy, not the source; a true iOS sync needs
// a separate source-path column and is left as a follow-up.

import {
  getAllFolderSources,
  getBooksForSync,
  setBookActive,
  reconcileBookChapters,
  getBooksNeedingTitleRepair,
  updateBookTitle,
} from "./database";
import {
  scanAndImportFolder,
  collectSAFBookFiles,
  getChapterTitleFromFilename,
  getBookTitleFromPath,
  AUDIO_EXTENSIONS,
} from "./scanner";

export interface SyncResult {
  imported: number;
  reactivated: number;
  deactivated: number;
  updatedBooks: number;
  message: string;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// One-time cleanup: fix titles mangled by the old SAF URI-decoding bug
// (e.g. "primary:Books/The Hobbit" -> "The Hobbit"). Idempotent — once a title
// has no "/" it no longer matches and is left alone.
async function repairBookTitles(): Promise<number> {
  let fixed = 0;
  for (const book of await getBooksNeedingTitleRepair()) {
    const corrected = getBookTitleFromPath(book.folder_path);
    if (corrected && corrected !== book.title && !corrected.includes("/")) {
      await updateBookTitle(book.id, corrected);
      fixed++;
    }
  }
  if (fixed > 0) console.log(`Sync: repaired ${fixed} book title(s)`);
  return fixed;
}

export async function syncLibrary(): Promise<SyncResult> {
  await repairBookTitles();

  const sources = await getAllFolderSources();
  const safSources = sources.filter((s) => s.uri.startsWith("content://"));

  let imported = 0;
  let reactivated = 0;
  let deactivated = 0;
  let updatedBooks = 0;

  // 1. Import any brand-new books. The existing scan is idempotent
  //    (it skips folders already in the DB via bookExistsAtPath), so this
  //    only adds folders that appeared since the last run.
  for (const source of safSources) {
    try {
      const res = await scanAndImportFolder(source.uri);
      if (res.success) imported += res.booksImported;
    } catch (e) {
      console.error("Sync: import scan failed for", source.uri, e);
    }
  }

  // 2. Reconcile existing books that live under a SAF source.
  const dbBooks = await getBooksForSync();
  for (const book of dbBooks) {
    // Anchor the prefix with a trailing "/" so a source URI that is a string
    // prefix of another (e.g. ".../tree/primary%3ABook" vs
    // ".../tree/primary%3ABooks") can't falsely claim the longer source's books.
    const underSaf = safSources.some(
      (s) => book.folder_path === s.uri || book.folder_path.startsWith(s.uri + "/")
    );
    if (!underSaf) continue;

    // Single-file / loose books store a synthetic folder_path of
    // `${folder}/${filename.ext}` (see importSingleFile). That's not a real
    // directory — listing it would mistakenly enumerate the parent folder and
    // make this book try to claim files owned by other books (chapters
    // .file_path is globally UNIQUE). Skip them. Single-file deactivation
    // would need a per-URI existence probe (TODO).
    const isSingleFileBook = AUDIO_EXTENSIONS.some((ext) =>
      book.folder_path.toLowerCase().endsWith(ext)
    );
    if (isSingleFileBook) continue;

    let files: { uri: string; name: string; sortKey: string }[];
    try {
      // Throws if folder_path isn't a listable directory.
      files = await collectSAFBookFiles(book.folder_path);
    } catch {
      continue;
    }

    if (files.length === 0) {
      // Folder still exists but has no audio — hide the book.
      if (book.is_active === 1) {
        await setBookActive(book.id, false);
        deactivated++;
      }
      continue;
    }

    files.sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
    const desired = files.map((f) => ({
      filePath: f.uri,
      title: getChapterTitleFromFilename(f.name),
    }));

    const result = await reconcileBookChapters(book.id, desired);

    if (book.is_active === 0) {
      await setBookActive(book.id, true);
      reactivated++;
    }
    if (result.added > 0 || result.removed > 0) {
      updatedBooks++;
      console.log(
        `Sync: book ${book.id} reconciled (+${result.added} / -${result.removed} chapters)`
      );
    }
  }

  return {
    imported,
    reactivated,
    deactivated,
    updatedBooks,
    message: `Sync complete — ${imported} new, ${updatedBooks} updated, ${deactivated} hidden, ${reactivated} restored`,
  };
}
