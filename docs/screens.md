# Screens

## Home Screen (`app/index.tsx`)

The main screen showing the user's audiobook library.

**Sections:**
- **In Progress** - Books with saved progress, sorted by most recently played
- **Not Started** - Books without progress, sorted alphabetically

**Features:**
- Tap a book to open the player
- Long-press a book for a context menu (edit title, reset progress, remove)
- Floating action button: play/pause when a book is loaded, or navigate to add folder when not
- Auto-scans all folder sources on app launch for new books
- Refreshes book list on screen focus

**Navigation:**
- Header icons link to Analytics, Folder Sources, and Settings (placeholder)

## Player Screen (`app/player/[id].tsx`)

Full-screen audio player with playback controls.

**Features:**
- Book cover art display (or placeholder icon)
- Chapter title and position (e.g., "Chapter 3 of 12")
- Seek slider with current/total time
- Play/pause, skip forward/back 30 seconds, previous/next chapter
- Adjustable playback speed (0.5x - 3.0x) via toggle slider
- Link to per-book analytics

**Behavior:**
- Loads book and restores saved position on mount
- Progress auto-saves every 5 seconds and on seek
- Playback state syncs with system media controls

## Folder Sources Screen (`app/select-folder.tsx`)

Manage audiobook source folders.

**Features:**
- List of added folder sources with rescan and remove actions
- "Rescan All" button to check all sources for new books
- "Add Folder" button to pick a new source
  - Android: SAF directory picker
  - iOS: Document picker (selects a file, infers parent directory)
- Info box explaining multi-folder support and skip-if-exists behavior

## Analytics Dashboard (`app/analytics/index.tsx`)

Overview of listening statistics.

**Summary cards:** Books started, books completed, total listening time

**Filter tabs:** All Time, This Year, This Month

**Completions chart:** Bar chart showing books completed per month

**Book lists:**
- Completed books with date range and days to finish
- In-progress books with start date
- Both link to the per-book detail screen
- Removed books show a "Removed" badge

## Book Analytics Detail (`app/analytics/[id].tsx`)

Detailed stats for a single book.

**Display:**
- Cover art, title, author
- "Removed from Library" indicator if applicable
- Stats grid: started date, status, time listened, time to complete / estimated remaining
- Completion details section (for finished books): completion date, days to finish, book duration
