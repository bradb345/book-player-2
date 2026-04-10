/**
 * Formats milliseconds into a human-readable duration string.
 * Examples: "2h 30m", "45m", "12s"
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  const seconds = Math.floor(ms / 1000);
  return `${seconds}s`;
}

/**
 * Formats milliseconds into a playback time string (H:MM:SS or M:SS).
 */
export function formatPlaybackTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Formats an ISO date string into a short locale date (e.g., "Jan 5, 2025").
 */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Calculates the number of days between two ISO date strings (minimum 1).
 */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
}
