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

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync("audiobooks.db");
  await initializeDatabase(db);
  return db;
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
  `);
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
  const database = await getDatabase();
  return await database.getAllAsync<Book>(`SELECT * FROM books ORDER BY title`);
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

export async function updateProgress(
  bookId: number,
  currentChapterId: number,
  positionMs: number
): Promise<void> {
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
