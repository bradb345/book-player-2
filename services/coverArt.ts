// Cover art helpers.
//
// Two jobs live here:
//   1. extractEmbeddedCover() — pull the artwork baked into an audio file's
//      metadata (ID3v2 "APIC" for MP3, the MP4 "covr" atom for m4a/m4b/aac)
//      so single-file books that ship their cover *inside* the file still get
//      one, the way Voice does it natively with MediaMetadataRetriever.
//   2. saveCoverFromBase64 / saveCoverFromLocalFile / clearBookCovers — the
//      one place that owns where a book's cover file lives, so embedded
//      extraction, sidecar copies, and the internet picker all agree on it.
//
// The parser is pure JS and reads the file in small windows via
// expo-file-system, so a 400 MB m4b never has to be slurped into memory. It
// only runs on readable file:// URIs (iOS copies imported files into app
// storage; loose local files). Android SAF content:// sources aren't copied
// and can't be range-read, so embedded extraction is skipped there and those
// books fall back to the "Cover from internet" picker — an accepted tradeoff.

import * as FileSystem from "expo-file-system/legacy";
import { getEmbeddedArtwork } from "@/modules/audio-metadata";

// Hermes (RN 0.81) exposes base64 atob/btoa globally, but there's no DOM lib
// in this project's TS config to type them.
declare const atob: (data: string) => string;
declare const btoa: (data: string) => string;

// APIC images for audiobooks are tens of KB to ~1 MB. Cap how much of an ID3
// tag we'll pull into memory so a pathological tag can't OOM the import.
const MAX_ID3_TAG_BYTES = 12 * 1024 * 1024;
// Guard against malformed/looping atom trees.
const MAX_ATOM_ITERATIONS = 512;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

async function readBytes(
  uri: string,
  position: number,
  length: number,
): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
  return base64ToBytes(b64);
}

function u32be(b: Uint8Array, o: number): number {
  return (
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  );
}

function u24be(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}

// ID3 size fields are "synchsafe": 7 bits per byte, MSB always 0.
function synchsafe(b: Uint8Array, o: number): number {
  return (
    ((b[o] & 0x7f) << 21) |
    ((b[o + 1] & 0x7f) << 14) |
    ((b[o + 2] & 0x7f) << 7) |
    (b[o + 3] & 0x7f)
  );
}

function ascii(b: Uint8Array, o: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

function extFromMime(mime: string): "jpg" | "png" | null {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpg") || m.includes("jpeg")) return "jpg";
  return null;
}

function extFromMagic(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  return null;
}

interface ExtractedImage {
  bytes: Uint8Array;
  ext: "jpg" | "png";
}

// ---- ID3v2 (MP3) ----

async function extractFromId3(uri: string): Promise<ExtractedImage | null> {
  const header = await readBytes(uri, 0, 10);
  if (header.length < 10 || ascii(header, 0, 3) !== "ID3") return null;

  const versionMajor = header[3];
  const tagSize = synchsafe(header, 6);
  if (tagSize <= 0 || tagSize > MAX_ID3_TAG_BYTES) return null;

  const tag = await readBytes(uri, 10, tagSize);
  let pos = 0;

  // v2.2 frames: 3-char id + 3-byte size. v2.3/2.4: 4-char id + 4-byte size
  // (synchsafe in 2.4, plain in 2.3) + 2 flag bytes.
  const isV2 = versionMajor === 2;
  const headerLen = isV2 ? 6 : 10;

  while (pos + headerLen <= tag.length) {
    const id = ascii(tag, pos, isV2 ? 3 : 4);
    // Padding (zero bytes) marks the end of the frames.
    if (id.charCodeAt(0) === 0) break;

    let frameSize: number;
    if (isV2) {
      frameSize = u24be(tag, pos + 3);
    } else if (versionMajor === 4) {
      frameSize = synchsafe(tag, pos + 4);
    } else {
      frameSize = u32be(tag, pos + 4);
    }
    if (frameSize <= 0 || pos + headerLen + frameSize > tag.length) break;

    const isPic = (isV2 && id === "PIC") || (!isV2 && id === "APIC");
    if (isPic) {
      let p = pos + headerLen;
      const end = p + frameSize;
      const encoding = tag[p];
      p += 1;

      let mime: string;
      if (isV2) {
        // v2.2 PIC uses a 3-char image format code ("JPG"/"PNG") instead of MIME.
        mime = ascii(tag, p, 3);
        p += 3;
      } else {
        let m = "";
        while (p < end && tag[p] !== 0x00) {
          m += String.fromCharCode(tag[p]);
          p += 1;
        }
        p += 1; // MIME null terminator
        mime = m;
      }

      p += 1; // picture type byte

      // Skip the description string. UTF-16 encodings (1, 2) use a 2-byte
      // terminator; latin1/UTF-8 (0, 3) use 1 byte.
      const wide = encoding === 1 || encoding === 2;
      while (p < end) {
        if (wide) {
          if (tag[p] === 0x00 && tag[p + 1] === 0x00) {
            p += 2;
            break;
          }
          p += 2;
        } else {
          if (tag[p] === 0x00) {
            p += 1;
            break;
          }
          p += 1;
        }
      }

      if (p < end) {
        const bytes = tag.slice(p, end);
        const ext = extFromMime(mime) ?? extFromMagic(bytes);
        if (ext && bytes.length > 0) return { bytes, ext };
      }
      return null;
    }

    pos += headerLen + frameSize;
  }

  return null;
}

// ---- MP4 / m4a / m4b ("covr" atom) ----

interface AtomHeader {
  size: number; // total atom size including header
  type: string;
  headerLen: number;
}

async function readAtomHeader(
  uri: string,
  pos: number,
  fileSize: number,
): Promise<AtomHeader | null> {
  if (pos + 8 > fileSize) return null;
  const head = await readBytes(uri, pos, 16);
  if (head.length < 8) return null;
  let size = u32be(head, 0);
  const type = ascii(head, 4, 4);
  let headerLen = 8;
  if (size === 1) {
    if (head.length < 16) return null;
    // 64-bit size: high 32 bits are effectively never set for audiobooks.
    size = u32be(head, 12);
    headerLen = 16;
  } else if (size === 0) {
    size = fileSize - pos; // extends to EOF
  }
  if (size < headerLen) return null;
  return { size, type, headerLen };
}

// Scan the direct children of a container for `wantType`, returning the byte
// range of its contents. `fullBox` skips the 4-byte version/flags that the
// "meta" atom carries before its children.
async function findChild(
  uri: string,
  start: number,
  end: number,
  wantType: string,
  fileSize: number,
  fullBox = false,
): Promise<{ contentStart: number; contentEnd: number } | null> {
  let pos = fullBox ? start + 4 : start;
  let iterations = 0;
  while (pos + 8 <= end && iterations < MAX_ATOM_ITERATIONS) {
    iterations += 1;
    const h = await readAtomHeader(uri, pos, fileSize);
    if (!h) return null;
    if (h.type === wantType) {
      return { contentStart: pos + h.headerLen, contentEnd: pos + h.size };
    }
    pos += h.size;
  }
  return null;
}

async function extractFromMp4(uri: string, fileSize: number): Promise<ExtractedImage | null> {
  // Path: moov > udta > meta(fullbox) > ilst > covr > data
  const moov = await findChild(uri, 0, fileSize, "moov", fileSize);
  if (!moov) return null;
  const udta = await findChild(uri, moov.contentStart, moov.contentEnd, "udta", fileSize);
  if (!udta) return null;
  const meta = await findChild(uri, udta.contentStart, udta.contentEnd, "meta", fileSize);
  if (!meta) return null;
  const ilst = await findChild(
    uri,
    meta.contentStart,
    meta.contentEnd,
    "ilst",
    fileSize,
    true, // meta is a full box
  );
  if (!ilst) return null;
  const covr = await findChild(uri, ilst.contentStart, ilst.contentEnd, "covr", fileSize);
  if (!covr) return null;
  const data = await findChild(uri, covr.contentStart, covr.contentEnd, "data", fileSize);
  if (!data) return null;

  // `data` payload: 4 bytes (version + type flags) + 4 bytes reserved/locale,
  // then the raw image. Low byte of the type flags is 13=JPEG, 14=PNG.
  const imgStart = data.contentStart + 8;
  const imgLen = data.contentEnd - imgStart;
  if (imgLen <= 0 || imgLen > MAX_ID3_TAG_BYTES) return null;
  const bytes = await readBytes(uri, imgStart, imgLen);
  const ext = extFromMagic(bytes);
  if (!ext) return null;
  return { bytes, ext };
}

// ---- public API ----

function audiobooksDir(): string {
  return `${FileSystem.documentDirectory}audiobooks/`;
}

function bookDir(bookId: number): string {
  return `${audiobooksDir()}book_${bookId}/`;
}

async function ensureBookDir(bookId: number): Promise<string> {
  const dir = bookDir(bookId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

// Remove any previously stored cover files for this book. The cover filename
// is content-addressed by timestamp so a new cover never reuses a URI (which
// would let React Native's image cache show the stale image); this stops the
// orphans from accumulating.
async function clearBookCovers(bookId: number): Promise<void> {
  try {
    const dir = bookDir(bookId);
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;
    const entries = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      entries
        .filter((n) => n.startsWith("cover_"))
        .map((n) => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true })),
    );
  } catch {
    // Best effort — a leftover cover file is harmless.
  }
}

export async function saveCoverFromBase64(
  bookId: number,
  base64: string,
  ext: string,
): Promise<string> {
  const dir = await ensureBookDir(bookId);
  await clearBookCovers(bookId);
  const dest = `${dir}cover_${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(dest, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return dest;
}

// Move an already-downloaded local file (e.g. expo-file-system downloadAsync
// result in the cache dir) into the book folder as its cover.
export async function saveCoverFromLocalFile(
  bookId: number,
  localUri: string,
  ext: string,
): Promise<string> {
  const dir = await ensureBookDir(bookId);
  await clearBookCovers(bookId);
  const dest = `${dir}cover_${Date.now()}.${ext}`;
  await FileSystem.moveAsync({ from: localUri, to: dest });
  return dest;
}

function isRangeReadable(uri: string): boolean {
  // Range reads work for app-sandbox / local files. Android SAF content://
  // and remote URIs can't be windowed-read.
  return uri.startsWith("file://") || uri.startsWith("/");
}

// Pull embedded artwork out of an audio file and store it as the book's
// cover. Returns the saved cover URI, or null when there's nothing embedded.
// Never throws — cover art is best effort and must not break an import.
//
// Order:
//   1. the native module (Android MediaMetadataRetriever / iOS AVAsset) —
//      handles SAF content:// without copying, all file sizes, like Voice.
//   2. the pure-JS parser — fallback for range-readable file:// URIs when
//      the native module isn't available (dev client not yet rebuilt).
export async function extractEmbeddedCover(
  audioUri: string,
  bookId: number,
): Promise<string | null> {
  try {
    const nativeB64 = await getEmbeddedArtwork(audioUri);
    if (nativeB64) {
      const head = base64ToBytes(nativeB64.slice(0, 16));
      const ext = extFromMagic(head) ?? "jpg";
      return await saveCoverFromBase64(bookId, nativeB64, ext);
    }

    if (!isRangeReadable(audioUri)) return null;

    const lower = audioUri.toLowerCase();
    let img: ExtractedImage | null = null;

    if (lower.endsWith(".mp3")) {
      img = await extractFromId3(audioUri);
    } else if (
      lower.endsWith(".m4a") ||
      lower.endsWith(".m4b") ||
      lower.endsWith(".mp4") ||
      lower.endsWith(".aac")
    ) {
      const info = await FileSystem.getInfoAsync(audioUri);
      if (!info.exists || !info.size) return null;
      img = await extractFromMp4(audioUri, info.size);
    } else {
      // Some files carry an ID3 tag regardless of extension — try it as a
      // last resort before giving up.
      img = await extractFromId3(audioUri);
    }

    if (!img) return null;

    return await saveCoverFromBase64(bookId, bytesToBase64(img.bytes), img.ext);
  } catch (e) {
    console.warn("Embedded cover extraction failed:", e);
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}
