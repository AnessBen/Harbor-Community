/** Share one index build among concurrent callers; refresh invalidates in-flight builds. */
export function createAsyncIndexCache<K, V>() {
  const values = new Map<K, V>();
  const pending = new Map<K, Promise<V>>();

  return {
    peek(key: K): V | undefined {
      return values.get(key);
    },
    read(key: K, load: () => Promise<V>): Promise<V> {
      if (values.has(key)) return Promise.resolve(values.get(key)!);
      const running = pending.get(key);
      if (running) return running;
      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          if (pending.get(key) === request) values.set(key, value);
          return value;
        })
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
      return request;
    },
    invalidate(key?: K): void {
      if (key === undefined) {
        values.clear();
        pending.clear();
      } else {
        values.delete(key);
        pending.delete(key);
      }
    },
  };
}

/** Stop awaiting stale or unresponsive providers, even when their SDK ignores AbortSignal. */
export function withSearchDeadline<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      controller.abort();
      finish(() => reject(new Error("eBook search cancelled or timed out")));
    };
    const timer = setTimeout(abort, timeoutMs);
    parentSignal?.addEventListener("abort", abort, { once: true });
    if (parentSignal?.aborted) {
      abort();
      return;
    }
    try {
      start(controller.signal).then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
