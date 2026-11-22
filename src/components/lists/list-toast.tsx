import { Check, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/together-modal/avatar";
import type { Participant } from "@/lib/together/protocol";

type ListenerAvatar = Pick<Participant, "name" | "avatar" | "color">;
type Toast = {
  id: number;
  text: string;
  tone: "success" | "error";
  listener?: ListenerAvatar;
  position: "center" | "right";
};

const listeners = new Set<(t: Toast) => void>();
let seq = 0;

function showToast(toast: Omit<Toast, "id">): void {
  const next = { ...toast, id: ++seq };
  for (const fn of listeners) fn(next);
}

export function emitListToast(text: string, tone: Toast["tone"] = "success"): void {
  showToast({ text, tone, position: "center" });
}

export function emitListenAlongToast(
  text: string,
  tone: Toast["tone"] = "success",
  listener?: ListenerAvatar,
): void {
  showToast({ text, tone, listener, position: "right" });
}

export function ListToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onToast = (t: Toast) => {
      setToast(t);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), 2400);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  return createPortal(
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      style={{
        bottom: "calc(1.5rem + var(--harbor-music-dock, 0px) + var(--harbor-viewport-bottom, 0px))",
      }}
      className={`pointer-events-none fixed bottom-6 z-[260] animate-popover-in ${toast.position === "right" ? "right-4 max-w-[calc(100%-2rem)]" : "left-1/2 -translate-x-1/2"}`}
    >
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-edge-soft bg-elevated/95 py-1.5 ps-1.5 pe-4 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)] backdrop-blur-md">
        {toast.listener ? (
          <span aria-hidden="true" className="shrink-0">
            <Avatar
              name={toast.listener.name}
              src={toast.listener.avatar}
              color={toast.listener.color}
              size={28}
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${toast.tone === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"}`}
          >
            {toast.tone === "error" ? (
              <CircleAlert size={15} strokeWidth={2} />
            ) : (
              <Check size={13} strokeWidth={2.6} />
            )}
          </span>
        )}
        <span className="text-[12.5px] font-medium text-ink">{toast.text}</span>
      </div>
    </div>,
    document.body,
  );
}
