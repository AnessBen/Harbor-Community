// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import test from "node:test";
import type { EBook } from "../src/lib/ebook/api";
import {
  applyLocalEBookDetails,
  isLocalEBook,
  localEBookDetails,
  resetLocalEBookDetails,
  saveLocalEBookDetails,
} from "../src/lib/ebook/local-details";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const map = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() {
      return map.size;
    },
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => [...map.keys()][index] ?? null,
  },
});

const source: EBook = {
  id: "source:local%3Aabc:C%3A%5Cbooks%5Csample.pdf",
  source: "source",
  providerId: "local:abc",
  title: "Original",
  authors: ["First Author"],
  description: "Original description",
  year: 2021,
  cover: "original-cover.jpg",
  genres: ["Original genre"],
};

test("local book details persist as overrides without modifying the original book", () => {
  assert.equal(isLocalEBook(source), true);
  assert.equal(localEBookDetails(source.id), null);
  saveLocalEBookDetails(source, {
    title: "  Renamed PDF ",
    authors: ["Second Author", ""],
    description: "Custom description",
    year: 2019,
    genres: ["Updated"],
    cover: "data:image/jpeg;base64,/9j",
  });
  const changed = applyLocalEBookDetails(source);
  assert.equal(changed.title, "Renamed PDF");
  assert.deepEqual(changed.authors, ["Second Author"]);
  assert.equal(changed.description, "Custom description");
  assert.equal(changed.year, 2019);
  assert.deepEqual(changed.genres, ["Updated"]);
  assert.equal(changed.cover, "data:image/jpeg;base64,/9j");
  assert.equal(changed.internalCover, "data:image/jpeg;base64,/9j");
  assert.equal(source.title, "Original");
  assert.equal(source.cover, "original-cover.jpg");
  resetLocalEBookDetails(source);
  assert.equal(localEBookDetails(source.id), null);
  assert.equal(applyLocalEBookDetails(source), source);
});

test("editing is restricted to local books and oversized cover data is rejected", () => {
  const external = { ...source, source: "openlibrary" as const, providerId: "openlibrary" };
  assert.equal(isLocalEBook(external), false);
  assert.throws(
    () =>
      saveLocalEBookDetails(external, {
        title: "Bad",
        authors: [],
        description: "",
        genres: [],
      }),
    /Only local/,
  );
  assert.throws(
    () =>
      saveLocalEBookDetails(source, {
        title: "  ",
        authors: [],
        description: "",
        genres: [],
      }),
    /title cannot be empty/,
  );
  assert.throws(
    () =>
      saveLocalEBookDetails(source, {
        title: "PDF",
        authors: [],
        description: "",
        genres: [],
        cover: "data:image/png;base64,abcd",
      }),
    /cover is too large/,
  );
});

test("the persisted local override survives a simulated reload", () => {
  saveLocalEBookDetails(source, {
    title: "Library title",
    authors: [],
    description: "",
    genres: [],
  });
  const saved = map.get("harbor.ebook.local-details.v1");
  assert.ok(saved);
  map.clear();
  map.set("harbor.ebook.local-details.v1", saved);
  assert.equal(applyLocalEBookDetails({ ...source }).title, "Library title");
  resetLocalEBookDetails(source);
});

test("removing a custom cover retains other edits and restores original artwork", () => {
  saveLocalEBookDetails(source, {
    title: "Custom title",
    authors: ["Custom author"],
    description: "Custom description",
    genres: [],
    cover: "data:image/jpeg;base64,/9j",
  });
  saveLocalEBookDetails(source, {
    title: "Custom title",
    authors: ["Custom author"],
    description: "Custom description",
    genres: [],
  });
  assert.equal(localEBookDetails(source.id)?.cover, undefined);
  const updated = applyLocalEBookDetails(source);
  assert.equal(updated.cover, source.cover);
  assert.equal(updated.title, "Custom title");
  resetLocalEBookDetails(source);
});

test("restore the test environment storage descriptor", () => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
