import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Captions, ChevronLeft, Music2 } from "@/components/icons/music-icons";
import {
  errorText,
  MusicConnectionRow,
  SECONDARY_BUTTON,
} from "@/components/music/music-connections/connection-row";
import { useT } from "@/lib/i18n";
import { useNeteaseLyricsEnabled } from "@/lib/music/use-lyrics-provider-settings";
import { setNeteaseLyricsEnabled } from "@/lib/music/lyrics-provider-settings";
import { loadConnections } from "@/lib/music/catalog";
import { hydrateMusicSourceConsent } from "@/lib/music/source-consent";
import type { MusicConnection, MusicConnectionKind } from "@/lib/music/types";
import { MusicSourceConsent } from "./music-source-consent";

const GROUPS: Array<{ kind: MusicConnectionKind; label: string }> = [
  { kind: "local", label: "music.connections.local" },
  { kind: "streaming", label: "music.connections.streaming" },
  { kind: "server", label: "music.connections.server" },
  { kind: "scrobbler", label: "music.connections.scrobbler" },
  { kind: "catalog", label: "music.connections.catalog" },
];

export type MusicConnectionsStatus = "loading" | "ready" | "error";
type ConnectionsRequest = {
  focusId?: string;
  originLabel?: string | null;
  originText?: string | null;
};

type MusicConnectionsContextValue = {
  openConnections: (focusId?: string) => void;
  connections: MusicConnection[];
  status: MusicConnectionsStatus;
  error: string;
  connected: number;
  reload: () => void;
  apply: (next: MusicConnection) => void;
  request: ConnectionsRequest | null;
  closeConnections: () => void;
};

const MusicConnectionsContext = createContext<MusicConnectionsContextValue | null>(null);
let pendingConnection: string | null = null;
export function requestMusicConnection(focusId: string) {
  pendingConnection = focusId;
  window.dispatchEvent(new Event("harbor:music-connect"));
}

export function MusicConnectionsProvider({
  children,
  active = true,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const [request, setRequest] = useState<ConnectionsRequest | null>(null);
  const [connections, setConnections] = useState<MusicConnection[] | null>(null);
  const [error, setError] = useState("");
  const closeConnections = useCallback(() => setRequest(null), []);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) {
      setRequest(null);
      return;
    }
    const consume = () => {
      if (pendingConnection) {
        setRequest({ focusId: pendingConnection });
        pendingConnection = null;
      }
    };
    consume();
    window.addEventListener("harbor:music-connect", consume);
    return () => window.removeEventListener("harbor:music-connect", consume);
  }, [active]);

  const reload = useCallback(() => {
    const run = ++generation.current;
    setError("");
    void Promise.all([loadConnections(), hydrateMusicSourceConsent()])
      .then(([next]) => {
        if (generation.current !== run) return;
        setConnections(Array.isArray(next) ? next : []);
      })
      .catch((reason) => {
        if (generation.current !== run) return;
        setError(errorText(reason));
      });
  }, []);

  useEffect(() => {
    if (!active) return;
    reload();
    return () => {
      generation.current += 1;
    };
  }, [active, reload]);

  const apply = useCallback((next: MusicConnection) => {
    setConnections((current) =>
      current ? current.map((item) => (item.id === next.id ? next : item)) : current,
    );
  }, []);

  const openConnections = useCallback(
    (focusId?: string) => {
      if (!active) return;
      const trigger = document.activeElement;
      setRequest({
        focusId,
        originLabel: trigger?.getAttribute("aria-label"),
        originText: trigger?.textContent,
      });
      reload();
    },
    [active, reload],
  );

  const value = useMemo<MusicConnectionsContextValue>(() => {
    const list = connections ?? [];
    return {
      openConnections,
      connections: list,
      status: error ? "error" : connections ? "ready" : "loading",
      error,
      connected: list.filter((item) => item.status === "connected" && !item.anonymous).length,
      reload,
      apply,
      request,
      closeConnections,
    };
  }, [apply, connections, error, openConnections, reload, request, closeConnections]);

  return (
    <MusicConnectionsContext.Provider value={value}>
      {children}
      {active && <MusicSourceConsent />}
    </MusicConnectionsContext.Provider>
  );
}

export function useMusicConnections(): MusicConnectionsContextValue {
  const value = useContext(MusicConnectionsContext);
  if (!value) throw new Error("Music connections must be used inside its provider");
  return value;
}

export function MusicConnections({ focusId, onClose }: { focusId?: string; onClose?: () => void }) {
  const t = useT();
  const { connections, status, error, connected, reload, apply } = useMusicConnections();
  const neteaseLyrics = useNeteaseLyricsEnabled();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (onClose || focusId) heading.current?.focus({ preventScroll: true });
  }, [focusId, onClose]);

  const groups = GROUPS.map((group) => ({
    ...group,
    items: connections.filter((item) => item.kind === group.kind),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="music-connections-page flex flex-col gap-6">
      {onClose && (
        <button
          type="button"
          data-music-inner-back
          onClick={onClose}
          className="flex w-fit items-center gap-2 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft size={17} />
          {t("music.watch.back")}
        </button>
      )}
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-edge-soft pb-6">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
            {t("music.connections.subtitle")}
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="mt-1 text-3xl font-semibold text-ink outline-none"
          >
            {t(onClose ? "music.hero.startCta" : "music.tab.sources")}
          </h2>
          {status === "ready" && connections.length > 0 && (
            <p className="mt-1 text-[13px] text-ink-muted">
              {t("music.footer.sourceCount", { connected, total: connections.length })}
            </p>
          )}
        </div>
      </header>

      <div className="flex min-h-40 flex-col gap-7 pb-5">
        <details className="text-[13px] leading-relaxed text-ink-muted">
          <summary className="w-fit cursor-pointer text-ink">{t("music.legal.title")}</summary>
          <p className="mt-3">{t("music.legal.services")}</p>
          <p className="mt-3">{t("music.legal.saving")}</p>
          <p className="mt-3">{t("music.legal.data")}</p>
        </details>
        <section>
          <h3 className="text-lg font-semibold text-ink">{t("music.lyrics.providers")}</h3>
          <div className="mt-3 overflow-hidden rounded-lg bg-surface">
            <div className="grid min-h-20 grid-cols-[40px_minmax(0,1fr)] items-center gap-4 border-b border-edge-soft px-5 py-4">
              <span className="grid size-10 place-items-center rounded-xl bg-raised text-ink-muted">
                <Captions size={24} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <strong className="text-[14px] font-semibold text-ink">LRCLIB</strong>
                  <span className="text-[11px] text-ink-muted">{t("music.lyrics.primary")}</span>
                </span>
                <span className="mt-1 block text-[13px] leading-5 text-ink-muted">
                  {t("music.lyrics.primaryHelp")}
                </span>
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t("music.lyrics.neteaseToggle")}
              aria-checked={neteaseLyrics}
              onClick={() => setNeteaseLyricsEnabled(!neteaseLyrics)}
              className="grid min-h-24 w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-start outline-none transition-colors hover:bg-elevated/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none max-[560px]:grid-cols-[36px_minmax(0,1fr)_auto] max-[560px]:gap-3 max-[560px]:px-4"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-[#d81f26] text-white max-[560px]:size-9">
                <Music2 size={25} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${neteaseLyrics ? "bg-accent" : "bg-ink-subtle"}`}
                    aria-hidden="true"
                  />
                  <strong className="text-[14px] font-semibold text-ink">
                    NetEase Cloud Music
                  </strong>
                  <span className="text-[11px] text-ink-muted">{t("music.lyrics.fallback")}</span>
                </span>
                <span className="mt-1 block text-[13px] leading-5 text-ink-muted">
                  {t("music.lyrics.neteaseHelp")}
                </span>
              </span>
              <span className="flex shrink-0 items-center" aria-hidden="true">
                <span
                  className={`relative block h-6 w-10 rounded-full transition-colors motion-reduce:transition-none ${neteaseLyrics ? "bg-ink" : "bg-edge"}`}
                >
                  <span
                    className={`absolute start-[3px] top-[3px] size-[18px] rounded-full bg-canvas shadow-sm transition-transform duration-200 motion-reduce:transition-none ${neteaseLyrics ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"}`}
                  />
                </span>
              </span>
            </button>
          </div>
        </section>
        {status === "loading" && (
          <div className="grid gap-2 p-4" aria-label={t("music.loading")}>
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-md bg-elevated/45" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="m-4 rounded-md border border-danger/30 bg-danger/5 p-4">
            <p className="text-[13px] leading-5 text-danger">{error}</p>
            <button type="button" onClick={reload} className={`mt-3 ${SECONDARY_BUTTON}`}>
              {t("common.retry")}
            </button>
          </div>
        )}

        {status === "ready" && connections.length === 0 && (
          <p className="px-5 py-8 text-[13px] text-ink-subtle">{t("music.connections.empty")}</p>
        )}

        {status !== "error" &&
          groups.map((group) => (
            <section key={group.kind}>
              <h3 className="text-lg font-semibold text-ink">{t(group.label)}</h3>
              <ul className="mt-3 overflow-hidden rounded-lg bg-surface">
                {group.items.map((item) => (
                  <MusicConnectionRow
                    key={item.id}
                    connection={item}
                    defaultOpen={item.id === focusId}
                    onChange={apply}
                    onRefresh={reload}
                  />
                ))}
              </ul>
            </section>
          ))}
      </div>
    </section>
  );
}
