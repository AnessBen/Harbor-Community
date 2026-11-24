import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readSettingsFile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return (await invoke<string | null>("settings_read")) ?? null;
  } catch {
    return null;
  }
}

let writes: Promise<void> = Promise.resolve();

export function writeSettingsFile(content: string, options?: { strict?: boolean }): Promise<void> {
  if (!isTauri) return Promise.resolve();
  const write = writes.then(async () => {
    await invoke("settings_write", { content });
  });
  // A failed write must not poison the queue. Ordinary autosaves remain
  // best-effort, but an explicit backup restore must report disk failures.
  writes = write.catch(() => {
    console.error("[settings] Could not save settings to disk");
  });
  return options?.strict ? write : writes;
}
