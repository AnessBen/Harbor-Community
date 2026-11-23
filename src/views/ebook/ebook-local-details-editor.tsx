import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Pencil, RotateCcw, X } from "lucide-react";
import type { EBook } from "@/lib/ebook/api";
import {
  localEBookDetails,
  resetLocalEBookDetails,
  saveLocalEBookDetails,
} from "@/lib/ebook/local-details";

type Props = {
  ebook: EBook;
  onClose: () => void;
  onSaved: () => void;
};

async function importedCover(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > 12_000_000)
    throw new Error("Choose a JPEG, PNG, WebP or AVIF image smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 640 / bitmap.width, 900 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The cover could not be processed.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const cover = canvas.toDataURL("image/jpeg", 0.8);
    canvas.width = 0;
    canvas.height = 0;
    if (cover.length > 750_000) throw new Error("The cover is too large after resizing.");
    return cover;
  } finally {
    bitmap.close();
  }
}

export function EBookLocalDetailsEditor({ ebook, onClose, onSaved }: Props) {
  const previous = localEBookDetails(ebook.id);
  const [title, setTitle] = useState(previous?.title ?? ebook.title);
  const [authors, setAuthors] = useState((previous?.authors ?? ebook.authors).join(", "));
  const [description, setDescription] = useState(previous?.description ?? ebook.description);
  const [year, setYear] = useState(String(previous?.year ?? ebook.year ?? ""));
  const [genres, setGenres] = useState((previous?.genres ?? ebook.genres).join(", "));
  const [cover, setCover] = useState(previous?.cover ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);

  const changeCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setWorking(true);
    setError("");
    try {
      setCover(await importedCover(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import this cover.");
    } finally {
      setWorking(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      saveLocalEBookDetails(ebook, {
        title,
        authors: authors.split(","),
        description,
        year: year.trim() ? Number(year) : undefined,
        genres: genres.split(","),
        ...(cover ? { cover } : {}),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save book details.");
    }
  };

  const restore = () => {
    try {
      resetLocalEBookDetails(ebook);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to restore book details.");
    }
  };

  const inputClass = "w-full rounded-xl border border-edge-soft bg-canvas/70 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-accent";
  const labelClass = "block space-y-1.5 text-[13px] font-medium text-ink-muted";
  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Edit local eBook details"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge-soft bg-elevated text-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge-soft px-6 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold"><Pencil size={19} /> Edit book details</div>
          <button type="button" aria-label="Close edit details" onClick={onClose} className="rounded-full p-2 hover:bg-raised"><X size={20} /></button>
        </header>
        <form id="ebook-local-edit-form" onSubmit={save} className="min-h-0 space-y-5 overflow-y-auto p-6">
          <p className="text-xs text-ink-muted">These changes affect your local Harbor library only. The original PDF or EPUB is not modified.</p>
          <div className="grid gap-5 sm:grid-cols-[120px_1fr]">
            <div className="space-y-3">
              <div className="aspect-[2/3] overflow-hidden rounded-lg bg-canvas ring-1 ring-edge-soft">
                {(cover || ebook.cover) ? <img src={cover || ebook.cover} alt="Cover preview" className="h-full w-full object-cover" /> :
                  <div className="flex h-full items-center justify-center text-ink-muted"><ImagePlus size={30} /></div>}
              </div>
              <label className="block cursor-pointer rounded-lg border border-edge-soft bg-raised px-2 py-2 text-center text-xs hover:border-accent">
                Change cover
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={changeCover}
                  className="sr-only" aria-label="Choose local book cover" />
              </label>
              {cover && <button type="button" onClick={() => setCover("")} className="w-full text-xs text-ink-muted hover:text-ink">Use original cover</button>}
            </div>
            <div className="space-y-4">
              <label className={labelClass}>Title
                <input required maxLength={240} className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className={labelClass}>Authors (comma-separated)
                <input className={inputClass} value={authors} onChange={(event) => setAuthors(event.target.value)} />
              </label>
              <label className={labelClass}>Publication year
                <input type="number" min="1" max="9999" className={inputClass} value={year} onChange={(event) => setYear(event.target.value)} />
              </label>
              <label className={labelClass}>Genres (comma-separated)
                <input className={inputClass} value={genres} onChange={(event) => setGenres(event.target.value)} />
              </label>
            </div>
          </div>
          <label className={labelClass}>Description
            <textarea rows={4} maxLength={10000} className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-edge-soft px-6 py-4">
          <button type="button" onClick={restore} disabled={working}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-ink-muted hover:bg-raised disabled:opacity-50">
            <RotateCcw size={16} /> Reset edits
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-ink-muted hover:bg-raised">Cancel</button>
            <button type="submit" form="ebook-local-edit-form" disabled={working || !title.trim()}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas disabled:opacity-50">
              {working ? "Processing cover…" : "Save changes"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
