# Database Schema

Book Player 2 uses **expo-sqlite** with WAL journal mode and foreign keys enabled. The database file is `audiobooks.db`.

## Tables

### books
The core table for imported audiobooks.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| title | TEXT NOT NULL | Book title (editable by user) |
| author | TEXT | Optional author name |
| cover_path | TEXT | URI to cover image |
| folder_path | TEXT NOT NULL UNIQUE | Source folder/file path (import dedup key) |
| total_duration_ms | INTEGER | Total duration across all chapters (discovered at playback) |
| created_at | TEXT | Timestamp of import |

### chapters
Audio files belonging to a book, ordered by position.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| book_id | INTEGER FK | References books(id) ON DELETE CASCADE |
| title | TEXT NOT NULL | Chapter title (derived from filename) |
| file_path | TEXT NOT NULL UNIQUE | Playable URI (content:// on Android, file:// on iOS) |
| duration_ms | INTEGER | Duration (0 until discovered during playback) |
| position | INTEGER NOT NULL | Sort order within the book |

### progress
Tracks the user's current position in each book. One row per book.

| Column | Type | Description |
|--------|------|-------------|
| book_id | INTEGER PK | References books(id) ON DELETE CASCADE |
| current_chapter_id | INTEGER FK | References chapters(id) ON DELETE SET NULL |
| position_ms | INTEGER | Position within the current chapter |
| last_played_at | TEXT | Last save timestamp (used for sorting "In Progress") |

### folder_sources
User-selected folder sources for scanning.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| uri | TEXT NOT NULL UNIQUE | Folder URI |
| name | TEXT NOT NULL | Display name |
| created_at | TEXT | When the source was added |

### book_history
Persistent analytics data that survives book deletion.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| book_id | INTEGER | Nullable - set to NULL when book is removed from library |
| title | TEXT NOT NULL | Snapshot of book title |
| author | TEXT | Snapshot of author |
| cover_path | TEXT | Snapshot of cover |
| total_duration_ms | INTEGER | Snapshot of total duration |
| started_at | TEXT | When the book was first added |
| completed_at | TEXT | When the last chapter finished (NULL if in progress) |
| is_in_library | INTEGER | 1 if still in library, 0 if removed |

### listening_sessions
Daily listening time per book, used for analytics.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| book_history_id | INTEGER FK | References book_history(id) ON DELETE CASCADE |
| duration_ms | INTEGER | Listening time for that day |
| session_date | TEXT NOT NULL | Date string (YYYY-MM-DD) |

**Unique index**: `(book_history_id, session_date)` - ensures one row per book per day, with upsert adding to the existing duration.

## Key Queries

### Progress with cumulative position
Used on the home screen to show overall book progress. Sums durations of all chapters before the current one, plus the current position within the chapter.

### Upsert listening session
Uses `INSERT ... ON CONFLICT DO UPDATE SET duration_ms = duration_ms + excluded.duration_ms` to accumulate listening time throughout the day.

## Initialization Migrations

`initializeDatabase()` runs two idempotent maintenance steps on every open:

- **Prune stale history**: deletes `book_history` rows with no `listening_sessions` — cleans up rows left by an earlier backfill that were never actually played.
- **`books.is_active` column**: added via `ALTER TABLE` if missing (SQLite has no `ADD COLUMN IF NOT EXISTS`). Inactive books are ones whose source files vanished on a sync pass; they are hidden from the library but kept (with progress + history) so they reappear if the files come back.
