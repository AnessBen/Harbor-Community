import { useT } from "@/lib/i18n";
import { useListenTogether } from "@/lib/listen-together/provider";

export function ListenAlongUpNext() {
  const { guestQueue, leave } = useListenTogether();
  const t = useT();
  const entries = guestQueue?.entries.filter(
    (entry) => entry.entryId !== guestQueue.currentEntryId,
  );
  return (
    <section className="music-queue-upcoming">
      <div className="music-queue-section-head">
        <h3>{t("music.row.upNext")}</h3>
        <button type="button" onClick={leave}>
          {t("Leave room")}
        </button>
      </div>
      {!entries?.length ? (
        <p className="music-queue-empty">{guestQueue ? t("music.queue.empty") : t("Loading…")}</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.entryId} className="px-3 py-1">
              <span className="block truncate text-ink">{entry.title}</span>
              <span className="block truncate text-sm text-ink-subtle">{entry.artist}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
