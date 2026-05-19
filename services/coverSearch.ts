// "Cover from internet" — a direct port of Voice's SelectCoverFromInternet
// (features/cover). DuckDuckGo's image search has no public API, so the same
// two-step dance Voice uses:
//
//   1. GET https://duckduckgo.com/?q=<query>  → scrape the one-time "vqd"
//      token out of the HTML.
//   2. GET https://duckduckgo.com/i.js?q=<query>&vqd=<token> → JSON list of
//      image results { image, thumbnail, width, height }.
//
// A browser-y User-Agent is required or DuckDuckGo serves a challenge page
// instead of the token (Voice sets one via an OkHttp interceptor).

import * as FileSystem from "expo-file-system/legacy";
import { saveCoverFromLocalFile } from "./coverArt";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface CoverResult {
  image: string;
  thumbnail: string;
  width: number;
  height: number;
}

async function fetchVqd(query: string): Promise<string | null> {
  const res = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { headers: { "User-Agent": USER_AGENT } },
  );
  const html = await res.text();
  // Voice's regex is `vqd=([\d-]+)&`; newer DuckDuckGo also emits
  // `vqd="4-123..."`, so try the quoted form too.
  const patterns = [
    /vqd=([\d-]+)&/,
    /vqd="([^"]+)"/,
    /vqd=([\d-]+)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

// Search for cover candidates. Returns [] when DuckDuckGo can't be reached or
// blocks the request — the caller surfaces that as an empty/error state.
export async function searchCovers(query: string): Promise<CoverResult[]> {
  const q = query.trim();
  if (!q) return [];

  const vqd = await fetchVqd(q);
  if (!vqd) return [];

  const url =
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}` +
    `&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: "https://duckduckgo.com/",
    },
  });

  // The endpoint is served as text/javascript, so parse the body ourselves
  // rather than trusting res.json().
  const text = await res.text();
  let json: { results?: CoverResult[] };
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }

  return (json.results ?? [])
    .filter((r) => r && typeof r.image === "string")
    .map((r) => ({
      image: r.image,
      thumbnail: r.thumbnail || r.image,
      width: r.width ?? 0,
      height: r.height ?? 0,
    }));
}

function guessExt(uri: string): "jpg" | "png" {
  return /\.png(\?|$)/i.test(uri) ? "png" : "jpg";
}

// Download a chosen result and store it as the book's cover. Falls back to
// the thumbnail if the full-resolution host blocks hotlinking (mirrors
// Voice's CoverDownloader, which tries image then thumbnail). Returns the
// saved cover URI, or null if both downloads fail.
export async function downloadCover(
  bookId: number,
  result: CoverResult,
): Promise<string | null> {
  const candidates = [result.image, result.thumbnail].filter(Boolean);
  for (const remote of candidates) {
    try {
      const tmp = `${FileSystem.cacheDirectory}cover_dl_${bookId}_${Date.now()}`;
      const dl = await FileSystem.downloadAsync(remote, tmp, {
        headers: { "User-Agent": USER_AGENT, Referer: "https://duckduckgo.com/" },
      });
      if (dl.status >= 200 && dl.status < 300) {
        return await saveCoverFromLocalFile(bookId, dl.uri, guessExt(remote));
      }
      await FileSystem.deleteAsync(dl.uri, { idempotent: true }).catch(() => {});
    } catch (e) {
      console.warn("Cover download failed for", remote, e);
    }
  }
  return null;
}
