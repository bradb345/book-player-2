// Library sync pass — keeps the DB in step with what's actually on disk,
// modeled on Voice's MediaScanner:
//
//   • brand-new book folders get imported (both Android SAF and iOS)
//   • books whose chapter files changed get reconciled (add/remove chapters)
//     while preserving playback progress — Android only
//   • books whose folders/files vanished are marked inactive (hidden) instead
//     of deleted, so progress + history survive and they reappear if the
//     files come back — Android only
//
// Android (SAF): chapters.file_path is the real content:// URI, so we can
// diff it directly against the filesystem and reconcile chapter sets.
//
// iOS (file://): files are copied into the app sandbox at import time and
// chapters.file_path points at the copies, so we can't diff individual
// chapters against the source. What we can do is re-scan the picked folder
// for *new* top-level books — that requires re-acquiring the security scope
// via a stored bookmark (see modules/folder-bookmark). Chapter reconciliation
// and orphan deactivation are left as a follow-up for iOS.

import {
  getAllFolderSources,
  getBooksForSync,
  setBookActive,
  reconcileBookChapters,
  getBooksNeedingTitleRepair,
  updateBookTitle,
  deleteBook,
  markBookHistoryDeleted,
  FolderSource,
} from "./database";
import {
  scanAndImportFolder,
  collectSAFBookFiles,
  collectLocalBookFolderPaths,
  deleteBookFiles,
  getChapterTitleFromFilename,
  getBookTitleFromPath,
  AUDIO_EXTENSIONS,
} from "./scanner";
import {
  isFolderBookmarkSupported,
  resolveBookmark,
  releaseBookmark,
} from "../modules/folder-bookmark";
import { naturalCompare } from "@/utils/sort";

export interface SyncResult {
  imported: number;
  reactivated: number;
  deactivated: number;
  updatedBooks: number;
  // iOS: books whose source file/folder was deleted by the user — fully
  // removed from the DB and their sandbox copies erased to free storage.
  removed: number;
  message: string;
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

// Resolve a folder source to a URI that's readable in this process, and a
// release function. Android SAF sources are persistent through their URI; iOS
// sources try to acquire the security scope from the stored bookmark.
//
// iOS without a stored bookmark (e.g. sources added before bookmark capture
// shipped, or where the picker couldn't issue one) still falls through to a
// scan attempt: the picker's transient process-scoped grant may still cover
// the URL — and crucially, this is exactly what the "Rescan" button on the
// folder-sources page does, so behavior matches user expectation. If access
// is actually gone the scan no-ops; it never crashes.
async function openFolderSource(
  source: FolderSource
): Promise<{ uri: string; release: () => Promise<void> }> {
  if (source.uri.startsWith("content://")) {
    return { uri: source.uri, release: async () => {} };
  }

  if (source.bookmark && isFolderBookmarkSupported) {
    const resolved = await resolveBookmark(source.bookmark);
    if (resolved) {
      if (resolved.stale) {
        // Still resolves this session, but iOS is telling us the user should
        // re-pick the folder eventually to refresh the bookmark.
        console.warn(
          `Sync: bookmark stale for "${source.name}" — re-pick the folder to refresh access.`
        );
      }
      return {
        // Scan with the *original* picker URI so folder_path comparisons stay
        // byte-equal against books imported on first pick (bookExistsAtPath).
        // The scope acquired on the resolved URL covers the same filesystem
        // path, so expo-file-system reads succeed.
        uri: source.uri,
        release: async () => {
          await releaseBookmark(resolved.uri);
        },
      };
    }
  }

  // No bookmark (or resolution failed). Best-effort scan with whatever
  // transient scope the process already holds.
  return { uri: source.uri, release: async () => {} };
}

export async function syncLibrary(): Promise<SyncResult> {
  await repairBookTitles();

  const sources = await getAllFolderSources();
  const safSources = sources.filter((s) => s.uri.startsWith("content://"));
  const iosSources = sources.filter((s) => !s.uri.startsWith("content://"));

  let imported = 0;
  let reactivated = 0;
  let deactivated = 0;
  let updatedBooks = 0;
  let removed = 0;

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

  // iOS sources: acquire the security scope from the stored bookmark, then
  //   (a) hard-delete books whose source file/folder was removed by the user
  //       (frees the sandbox copy storage; listening_sessions are preserved
  //       in book_history via markBookHistoryDeleted before the row is gone),
  //   (b) import any brand-new top-level books that appeared.
  // Chapter reconciliation inside existing books isn't supported on iOS yet
  // (chapters point at app-sandbox copies, not source files).
  //
  // (a) runs before (b) so a folder rename (delete-then-readd in the same
  // sync) is observable in counters but doesn't risk re-deleting a fresh
  // import.
  const allBooks = await getBooksForSync();
  for (const source of iosSources) {
    const opened = await openFolderSource(source);
    try {
      const sourcePrefix = opened.uri.replace(/\/+$/, "") + "/";
      // null = folder unreadable; SKIP deletion (treating that as "empty"
      // would wipe every book under this source). The import scan below is
      // also a no-op in that state, which matches the Rescan button.
      const expectedPaths = await collectLocalBookFolderPaths(opened.uri);

      if (expectedPaths) {
        const booksUnderSource = allBooks.filter(
          (b) => !b.folder_path.startsWith("content://") &&
                 b.folder_path.startsWith(sourcePrefix)
        );

        for (const book of booksUnderSource) {
          if (expectedPaths.has(book.folder_path)) continue;
          // Source vanished — user-driven cleanup. Preserve listening history
          // for analytics, drop the book row, then erase the sandbox copy.
          try {
            await markBookHistoryDeleted(book.id);
            await deleteBook(book.id);
            await deleteBookFiles(book.id).catch(() => {});
            removed++;
          } catch (e) {
            console.error("Sync: failed to hard-delete missing book", book.id, e);
          }
        }
      }

      const res = await scanAndImportFolder(opened.uri);
      if (res.success) imported += res.booksImported;
    } catch (e) {
      console.error("Sync: import scan failed for", source.uri, e);
    } finally {
      await opened.release();
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
    removed,
    message: `Sync complete — ${imported} new, ${updatedBooks} updated, ${removed} removed, ${deactivated} hidden, ${reactivated} restored`,
  };
}
