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
