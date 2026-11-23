import type { EBook } from "./api";
import { setItemWithRecovery } from "@/lib/storage-recovery";

/** User edits are separate from the original EPUB/PDF and external metadata caches. */
const KEY = "harbor.ebook.local-details.v1";

export type LocalEBookDetails = {
  title: string;
  authors: string[];
  description: string;
  year?: number;
  genres: string[];
  cover?: string;
};

let cachedValue = "";
let cachedDetails: Record<string, LocalEBookDetails> = {};
function stored(): Record<string, LocalEBookDetails> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(KEY) ?? "{}";
  if (raw === cachedValue) return cachedDetails;
  cachedValue = raw;
  try {
    const value: unknown = JSON.parse(raw);
    cachedDetails = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, LocalEBookDetails>
      : {};
  } catch {
    cachedDetails = {};
  }
  return cachedDetails;
}

export function isLocalEBook(ebook: EBook): boolean {
  return ebook.source === "source" && Boolean(ebook.providerId?.startsWith("local:"));
}

export function localEBookDetails(ebookId: string): LocalEBookDetails | null {
  const edit = stored()[ebookId];
  if (!edit || typeof edit.title !== "string" || !Array.isArray(edit.authors)) return null;
  return edit;
}

export function applyLocalEBookDetails<T extends EBook>(ebook: T): T {
  if (!isLocalEBook(ebook)) return ebook;
  const edit = localEBookDetails(ebook.id);
  if (!edit) return ebook;
  return {
    ...ebook,
    title: edit.title || ebook.title,
    authors: edit.authors,
    description: typeof edit.description === "string" ? edit.description : ebook.description,
    year: edit.year,
    genres: Array.isArray(edit.genres) ? edit.genres : ebook.genres,
    ...(edit.cover ? { cover: edit.cover, internalCover: edit.cover } : {}),
  };
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("harbor:ebook-local-details"));
  window.dispatchEvent(new Event("harbor:ebook-library"));
}

export function saveLocalEBookDetails(ebook: EBook, details: LocalEBookDetails): void {
  if (!isLocalEBook(ebook)) throw new Error("Only local eBooks can be edited.");
  const title = details.title.trim().slice(0, 240);
  if (!title) throw new Error("The book title cannot be empty.");
  const cover = details.cover;
  if (cover && (!/^data:image\/jpeg;base64,/.test(cover) || cover.length > 750_000))
    throw new Error("The selected cover is too large.");
  const next: LocalEBookDetails = {
    title,
    authors: details.authors.map((author) => author.trim().slice(0, 160)).filter(Boolean).slice(0, 20),
    description: details.description.trim().slice(0, 10_000),
    year: details.year && Number.isInteger(details.year) && details.year >= 1 && details.year <= 9999
      ? details.year
      : undefined,
    genres: details.genres.map((genre) => genre.trim().slice(0, 80)).filter(Boolean).slice(0, 30),
    ...(cover ? { cover } : {}),
  };
  if (!setItemWithRecovery(KEY, JSON.stringify({ ...stored(), [ebook.id]: next })))
    throw new Error("The book details could not be saved. Check available storage.");
  notify();
}

export function resetLocalEBookDetails(ebook: EBook): void {
  if (!isLocalEBook(ebook)) return;
  const next = stored();
  delete next[ebook.id];
  if (!setItemWithRecovery(KEY, JSON.stringify(next)))
    throw new Error("The original book details could not be restored.");
  notify();
}
