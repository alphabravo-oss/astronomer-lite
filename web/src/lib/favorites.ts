// Persisted per-cluster pinned resources. Stored under
// `astronomer-lite-favorites` as `{[clusterId]: Favorite[]}`. Favorites are
// keyed by (kind, namespace?, name) so the user pins a *specific* resource,
// not the row position.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "astronomer-lite-favorites";
const CHANGE_EVENT = "astronomer-lite-favorites:change";

export type Favorite = {
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  route?: string;
};

type AllFavorites = Record<string, Favorite[]>;

function readAll(): AllFavorites {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AllFavorites) : {};
  } catch {
    return {};
  }
}

function writeAll(value: AllFavorites) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Storage full / blocked — silently skip.
  }
}

function sameFavorite(a: Favorite, b: Favorite) {
  return a.kind === b.kind && (a.namespace ?? "") === (b.namespace ?? "") && a.name === b.name;
}

export function useFavorites(clusterId?: string) {
  const [favorites, setFavorites] = useState<Favorite[]>(() => (clusterId ? readAll()[clusterId] ?? [] : []));

  useEffect(() => {
    if (!clusterId) {
      setFavorites([]);
      return;
    }
    setFavorites(readAll()[clusterId] ?? []);
  }, [clusterId]);

  useEffect(() => {
    if (!clusterId) return;
    const id = clusterId;
    function refresh() {
      setFavorites(readAll()[id] ?? []);
    }
    function handleStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      refresh();
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, [clusterId]);

  const isFavorite = useCallback(
    (candidate: Favorite) => favorites.some((entry) => sameFavorite(entry, candidate)),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (candidate: Favorite) => {
      if (!clusterId) return;
      setFavorites((current) => {
        const next = current.some((entry) => sameFavorite(entry, candidate))
          ? current.filter((entry) => !sameFavorite(entry, candidate))
          : [...current, candidate];
        const all = readAll();
        all[clusterId] = next;
        writeAll(all);
        return next;
      });
    },
    [clusterId]
  );

  return { favorites, isFavorite, toggleFavorite };
}
