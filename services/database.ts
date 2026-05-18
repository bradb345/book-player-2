import * as SQLite from "expo-sqlite";

export interface Book {
  id: number;
  title: string;
  author: string | null;
  cover_path: string | null;
  folder_path: string;
  total_duration_ms: number;
  created_at: string;
}

export interface Chapter {
  id: number;
  book_id: number;
  title: string;
  file_path: string;
  duration_ms: number;
  position: number;
}

export interface Progress {
  book_id: number;
  current_chapter_id: number;
  position_ms: number;
  last_played_at: string;
}

export interface FolderSource {
  id: number;
  uri: string;
  name: string;
  created_at: string;
}

export interface BookHistory {
  id: number;
  book_id: number | null;
  title: string;
  author: string | null;
  cover_path: string | null;
  total_duration_ms: number;
  started_at: string;
  completed_at: string | null;
  is_in_library: number;
}

export interface ListeningSession {
  id: number;
  book_history_id: number;
  duration_ms: number;
  session_date: string;
}

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function resetDatabase(): void {
  db = null;
  dbPromise = null;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  // Prevent concurrent open attempts
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const database = await SQLite.openDatabaseAsync("audiobooks.db");
      await initializeDatabase(database);
      db = database;
      return database;
    } catch (error) {
      db = null;
      throw error;
    } finally {
      dbPromise = null;
    }
  })();

  return dbPromise;
}

// Run a DB operation with one retry on NullPointerException (dead native handle)
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("NullPointerException") || msg.includes("NativeDatabase")) {
      resetDatabase();
      return await operation();
    }
    throw e;
  }
}

async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      cover_path TEXT,
      folder_path TEXT NOT NULL UNIQUE,
      total_duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      duration_ms INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS progress (
      book_id INTEGER PRIMARY KEY,
      current_chapter_id INTEGER,
      position_ms INTEGER DEFAULT 0,
      last_played_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (current_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS folder_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uri TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS book_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER,
      title TEXT NOT NULL,
      author TEXT,
      cover_path TEXT,
      total_duration_ms INTEGER DEFAULT 0,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      is_in_library INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS listening_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_history_id INTEGER NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      session_date TEXT NOT NULL,
      FOREIGN KEY (book_history_id) REFERENCES book_history(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_sessions_unique
      ON listening_sessions(book_history_id, session_date);
  `);

  // Cleanup: remove book_history rows that were created by the old backfill
  // but never actually played (no listening sessions)
  await database.runAsync(`
    DELETE FROM book_history
    WHERE id NOT IN (SELECT DISTINCT book_history_id FROM listening_sessions)
  `);

  // Migration: books.is_active. Inactive books are ones whose source files
  // vanished on a sync pass — hidden from the library but kept (with progress
  // + history) so they reappear if the files come back. SQLite has no
  // "ADD COLUMN IF NOT EXISTS", so probe the schema first.
  const bookColumns = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(books)`
  );
  if (!bookColumns.some((c) => c.name === "is_active")) {
    await database.execAsync(
      `ALTER TABLE books ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`
    );
  }
}

export async function insertBook(
  title: string,
  folderPath: string,
  author?: string,
  coverPath?: string
): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO books (title, author, cover_path, folder_path) VALUES (?, ?, ?, ?)`,
    [title, author ?? null, coverPath ?? null, folderPath]
  );
  return result.lastInsertRowId;
}

export async function insertChapter(
  bookId: number,
  title: string,
  filePath: string,
  position: number,
  durationMs: number = 0
): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO chapters (book_id, title, file_path, position, duration_ms) VALUES (?, ?, ?, ?, ?)`,
    [bookId, title, filePath, position, durationMs]
  );
  return result.lastInsertRowId;
}

export async function getAllBooks(): Promise<Book[]> {
  return withRetry(async () => {
    const database = await getDatabase();
    return await database.getAllAsync<Book>(
      `SELECT * FROM books WHERE is_active = 1 ORDER BY title`
    );
  });
}

// ---- Sync support ----

export interface SyncBookRow {
  id: number;
  folder_path: string;
  is_active: number;
}

// All books including inactive ones — the sync pass needs to see hidden books
// so it can reactivate them when their files reappear.
export async function getBooksForSync(): Promise<SyncBookRow[]> {
  return withRetry(async () => {
    const database = await getDatabase();
    return await database.getAllAsync<SyncBookRow>(
      `SELECT id, folder_path, is_active FROM books`
    );
  });
}

// Books whose title still contains a "/" — the signature of the old SAF
// URI-decoding bug (e.g. "primary:Books/The Hobbit"). A real book/folder name
// never contains a slash, and user-edited titles won't either, so this is a
// safe filter for the one-time title repair.
export async function getBooksNeedingTitleRepair(): Promise<
  { id: number; folder_path: string; title: string }[]
> {
  return withRetry(async () => {
    const database = await getDatabase();
    return await database.getAllAsync<{
      id: number;
      folder_path: string;
      title: string;
    }>(`SELECT id, folder_path, title FROM books WHERE title LIKE '%/%'`);
  });
}

export async function setBookActive(bookId: number, active: boolean): Promise<void> {
  return withRetry(async () => {
    const database = await getDatabase();
    await database.runAsync(`UPDATE books SET is_active = ? WHERE id = ?`, [
      active ? 1 : 0,
      bookId,
    ]);
  });
}

export interface ReconcileResult {
  added: number;
  removed: number;
  kept: number;
}

// Reconcile a book's chapters against the `desired` list discovered on disk.
// Chapters are matched by file_path: existing rows are kept (so their ids stay
// stable and playback progress survives), missing ones are deleted, new ones
// inserted, and positions renumbered. If the chapter the user was on is gone,
// progress is repaired to the first chapter (mirrors Voice's MediaScanner).
export async function reconcileBookChapters(
  bookId: number,
  desired: { filePath: string; title: string }[]
): Promise<ReconcileResult> {
  return withRetry(async () => {
    const database = await getDatabase();

    const existing = await database.getAllAsync<{
      id: number;
      file_path: string;
    }>(`SELECT id, file_path FROM chapters WHERE book_id = ?`, [bookId]);

    const existingByPath = new Map(existing.map((c) => [c.file_path, c]));
    const desiredPaths = new Set(desired.map((d) => d.filePath));

    const progress = await database.getFirstAsync<{
      current_chapter_id: number | null;
    }>(`SELECT current_chapter_id FROM progress WHERE book_id = ?`, [bookId]);

    const currentPath =
      progress?.current_chapter_id != null
        ? existing.find((c) => c.id === progress.current_chapter_id)?.file_path ?? null
        : null;

    const toDelete = existing.filter((c) => !desiredPaths.has(c.file_path));
    let added = 0;
    let kept = 0;

    await database.withTransactionAsync(async () => {
      for (const c of toDelete) {
        await database.runAsync(`DELETE FROM chapters WHERE id = ?`, [c.id]);
      }
      for (let i = 0; i < desired.length; i++) {
        const d = desired[i];
        const ex = existingByPath.get(d.filePath);
        if (ex) {
          await database.runAsync(
            `UPDATE chapters SET position = ?, title = ? WHERE id = ?`,
            [i, d.title, ex.id]
          );
          kept++;
        } else {
          // chapters.file_path is globally UNIQUE. If this path already belongs
          // to a different book, the source folders overlap — skip rather than
          // crash the whole sync on the constraint.
          const owner = await database.getFirstAsync<{ book_id: number }>(
            `SELECT book_id FROM chapters WHERE file_path = ?`,
            [d.filePath]
          );
          if (owner && owner.book_id !== bookId) {
            console.warn(
              `Sync: skipping chapter already owned by book ${owner.book_id}: ${d.filePath}`
            );
            continue;
          }
          await database.runAsync(
            `INSERT INTO chapters (book_id, title, file_path, position, duration_ms) VALUES (?, ?, ?, ?, 0)`,
            [bookId, d.title, d.filePath, i]
          );
          added++;
        }
      }

      // Durations are filled in lazily by the player; recompute the book total
      // from whatever is currently known so a removed chapter doesn't inflate it.
      await database.runAsync(
        `UPDATE books SET total_duration_ms =
           (SELECT COALESCE(SUM(duration_ms), 0) FROM chapters WHERE book_id = ?)
         WHERE id = ?`,
        [bookId, bookId]
      );

      if (progress) {
        if (currentPath && desiredPaths.has(currentPath)) {
          const nc = await database.getFirstAsync<{ id: number }>(
            `SELECT id FROM chapters WHERE book_id = ? AND file_path = ?`,
            [bookId, currentPath]
          );
          if (nc) {
            await database.runAsync(
              `UPDATE progress SET current_chapter_id = ? WHERE book_id = ?`,
              [nc.id, bookId]
            );
          }
        } else {
          // The chapter the listener was on disappeared — restart the book.
          const first = await database.getFirstAsync<{ id: number }>(
            `SELECT id FROM chapters WHERE book_id = ? ORDER BY position LIMIT 1`,
            [bookId]
          );
          if (first) {
            await database.runAsync(
              `UPDATE progress SET current_chapter_id = ?, position_ms = 0 WHERE book_id = ?`,
              [first.id, bookId]
            );
          }
        }
      }
    });

    return { added, removed: toDelete.length, kept };
  });
}

export async function getBookWithChapters(bookId: number): Promise<{ book: Book; chapters: Chapter[] } | null> {
  const database = await getDatabase();
  const book = await database.getFirstAsync<Book>(`SELECT * FROM books WHERE id = ?`, [bookId]);
  if (!book) return null;

  const chapters = await database.getAllAsync<Chapter>(
    `SELECT * FROM chapters WHERE book_id = ? ORDER BY position`,
    [bookId]
  );

  return { book, chapters };
}

export async function getProgress(bookId: number): Promise<Progress | null> {
  const database = await getDatabase();
  return await database.getFirstAsync<Progress>(
    `SELECT * FROM progress WHERE book_id = ?`,
    [bookId]
  );
}

export interface ProgressWithCumulative extends Progress {
  cumulative_position_ms: number;
}

export async function getProgressWithCumulativePosition(bookId: number): Promise<ProgressWithCumulative | null> {
  return withRetry(async () => {
    const database = await getDatabase();

    const progress = await database.getFirstAsync<Progress>(
      `SELECT * FROM progress WHERE book_id = ?`,
      [bookId]
    );

    if (!progress) return null;

    // Get the position (order) of the current chapter
    const currentChapter = await database.getFirstAsync<{ position: number }>(
      `SELECT position FROM chapters WHERE id = ?`,
      [progress.current_chapter_id]
    );

    if (!currentChapter) {
      // Chapter not found, return progress with just current position
      return { ...progress, cumulative_position_ms: progress.position_ms };
    }

    // Sum durations of all chapters before the current one
    const result = await database.getFirstAsync<{ total_ms: number }>(
      `SELECT COALESCE(SUM(duration_ms), 0) as total_ms
       FROM chapters
       WHERE book_id = ? AND position < ?`,
      [bookId, currentChapter.position]
    );

    const previousChaptersDuration = result?.total_ms ?? 0;
    const cumulativePosition = previousChaptersDuration + progress.position_ms;

    return { ...progress, cumulative_position_ms: cumulativePosition };
  });
}

export async function updateProgress(
  bookId: number,
  currentChapterId: number,
  positionMs: number
): Promise<void> {
  return withRetry(async () => {
    const database = await getDatabase();
    await database.runAsync(
      `INSERT INTO progress (book_id, current_chapter_id, position_ms, last_played_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(book_id) DO UPDATE SET
         current_chapter_id = excluded.current_chapter_id,
         position_ms = excluded.position_ms,
         last_played_at = CURRENT_TIMESTAMP`,
      [bookId, currentChapterId, positionMs]
    );
  });
}

export async function updateChapterDuration(chapterId: number, durationMs: number): Promise<void> {
  return withRetry(async () => {
    const database = await getDatabase();
    await database.runAsync(
      `UPDATE chapters SET duration_ms = ? WHERE id = ?`,
      [durationMs, chapterId]
    );
  });
}

export async function updateBookDuration(bookId: number, totalDurationMs: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE books SET total_duration_ms = ? WHERE id = ?`,
    [totalDurationMs, bookId]
  );
}

export async function deleteBook(bookId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM books WHERE id = ?`, [bookId]);
}

export async function updateBookTitle(bookId: number, title: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE books SET title = ? WHERE id = ?`, [title, bookId]);
}

export async function updateBookAuthor(bookId: number, author: string | null): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE books SET author = ? WHERE id = ?`, [author, bookId]);
}

export async function resetBookProgress(bookId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM progress WHERE book_id = ?`, [bookId]);
}

export async function bookExistsAtPath(folderPath: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM books WHERE folder_path = ?`,
    [folderPath]
  );
  return (result?.count ?? 0) > 0;
}

// Folder source management
export async function addFolderSource(uri: string, name: string): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT OR IGNORE INTO folder_sources (uri, name) VALUES (?, ?)`,
    [uri, name]
  );
  return result.lastInsertRowId;
}

export async function getAllFolderSources(): Promise<FolderSource[]> {
  const database = await getDatabase();
  return await database.getAllAsync<FolderSource>(
    `SELECT * FROM folder_sources ORDER BY created_at DESC`
  );
}

export async function removeFolderSource(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM folder_sources WHERE id = ?`, [id]);
}

export async function folderSourceExists(uri: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM folder_sources WHERE uri = ?`,
    [uri]
  );
  return (result?.count ?? 0) > 0;
}

// Book history management
export async function getOrCreateBookHistory(bookId: number): Promise<BookHistory> {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<BookHistory>(
    `SELECT * FROM book_history WHERE book_id = ?`,
    [bookId]
  );
  if (existing) return existing;

  const book = await database.getFirstAsync<Book>(`SELECT * FROM books WHERE id = ?`, [bookId]);
  if (!book) throw new Error(`Book ${bookId} not found`);

  const result = await database.runAsync(
    `INSERT INTO book_history (book_id, title, author, cover_path, total_duration_ms, started_at, is_in_library)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)`,
    [book.id, book.title, book.author, book.cover_path, book.total_duration_ms]
  );

  // Read the row back so started_at reflects the actual CURRENT_TIMESTAMP the
  // DB wrote (avoids a JS/SQLite timezone + format mismatch).
  const created = await database.getFirstAsync<BookHistory>(
    `SELECT * FROM book_history WHERE id = ?`,
    [result.lastInsertRowId]
  );
  if (!created) throw new Error(`Failed to create book history for book ${bookId}`);
  return created;
}

export async function markBookHistoryCompleted(bookHistoryId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE book_history SET completed_at = CURRENT_TIMESTAMP WHERE id = ? AND completed_at IS NULL`,
    [bookHistoryId]
  );
}

export async function markBookHistoryDeleted(bookId: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE book_history SET is_in_library = 0, book_id = NULL WHERE book_id = ?`,
    [bookId]
  );
}

export async function updateBookHistoryDuration(bookHistoryId: number, totalDurationMs: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE book_history SET total_duration_ms = ? WHERE id = ?`,
    [totalDurationMs, bookHistoryId]
  );
}

export async function getBookHistoryByBookId(bookId: number): Promise<BookHistory | null> {
  const database = await getDatabase();
  return await database.getFirstAsync<BookHistory>(
    `SELECT * FROM book_history WHERE book_id = ?`,
    [bookId]
  );
}

export async function getBookHistoryById(id: number): Promise<BookHistory | null> {
  const database = await getDatabase();
  return await database.getFirstAsync<BookHistory>(
    `SELECT * FROM book_history WHERE id = ?`,
    [id]
  );
}

export async function getAllBookHistory(): Promise<BookHistory[]> {
  const database = await getDatabase();
  return await database.getAllAsync<BookHistory>(
    `SELECT * FROM book_history ORDER BY started_at DESC`
  );
}

export async function upsertListeningSession(bookHistoryId: number, additionalMs: number): Promise<void> {
  const database = await getDatabase();
  const today = new Date().toISOString().split("T")[0];
  await database.runAsync(
    `INSERT INTO listening_sessions (book_history_id, duration_ms, session_date)
     VALUES (?, ?, ?)
     ON CONFLICT(book_history_id, session_date) DO UPDATE SET
       duration_ms = duration_ms + excluded.duration_ms`,
    [bookHistoryId, additionalMs, today]
  );
}

export async function getTotalListeningTimeForBook(bookHistoryId: number): Promise<number> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(duration_ms), 0) as total FROM listening_sessions WHERE book_history_id = ?`,
    [bookHistoryId]
  );
  return result?.total ?? 0;
}

export async function getTotalListeningTime(): Promise<number> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(duration_ms), 0) as total FROM listening_sessions`
  );
  return result?.total ?? 0;
}

export async function getCompletionsPerMonth(year?: number): Promise<{ month: string; count: number }[]> {
  const database = await getDatabase();
  let query = `SELECT strftime('%Y-%m', completed_at) as month, COUNT(*) as count
               FROM book_history WHERE completed_at IS NOT NULL`;
  const params: number[] = [];
  if (year) {
    query += ` AND strftime('%Y', completed_at) = ?`;
    params.push(year);
  }
  query += ` GROUP BY month ORDER BY month`;
  return await database.getAllAsync<{ month: string; count: number }>(query, params.map(String));
}

export async function getDailyListeningStats(year?: number, month?: number): Promise<{ date: string; duration_ms: number }[]> {
  const database = await getDatabase();
  let query = `SELECT session_date as date, SUM(duration_ms) as duration_ms
               FROM listening_sessions WHERE 1=1`;
  const params: string[] = [];
  if (year) {
    query += ` AND strftime('%Y', session_date) = ?`;
    params.push(String(year));
  }
  if (month) {
    query += ` AND strftime('%m', session_date) = ?`;
    params.push(String(month).padStart(2, "0"));
  }
  query += ` GROUP BY session_date ORDER BY session_date`;
  return await database.getAllAsync<{ date: string; duration_ms: number }>(query, params);
}

export async function getFilteredBookHistory(year?: number, month?: number): Promise<BookHistory[]> {
  const database = await getDatabase();
  let query = `SELECT * FROM book_history WHERE 1=1`;
  const params: string[] = [];
  if (year) {
    query += ` AND strftime('%Y', started_at) = ?`;
    params.push(String(year));
  }
  if (month) {
    query += ` AND strftime('%m', started_at) = ?`;
    params.push(String(month).padStart(2, "0"));
  }
  query += ` ORDER BY started_at DESC`;
  return await database.getAllAsync<BookHistory>(query, params);
}
