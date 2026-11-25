import { useQueryClient } from "@tanstack/react-query";
import { employeeJourneyQueryKey } from "./employee-journey";
import { employeeGrantHeader, employeeStateSchema, stateKindSchema } from "@offboard/employee";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, use, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { ZodType } from "zod";
import { getEmployeeApi } from "../features/auth/session";

const readError = "Não foi possível abrir os dados da jornada.";
const writeError = "Não foi possível salvar.";

type Snapshot = {
  value: string | null;
} & (
  | { status: "loading" | "ready" | "read-error" }
  | { status: "saving" | "save-error"; draft: string; errorMessage: string }
);

export type WriteVisibility = "optimistic" | "confirmed";

function visibleValue(snapshot: Snapshot, visibility: WriteVisibility) {
  return visibility === "optimistic" && "draft" in snapshot ? snapshot.draft : snapshot.value;
}

class StateConflict extends Error {
  constructor(readonly currentValue: string) {
    super(
      "Os dados mudaram em outro dispositivo. Descarte esta tentativa e revise a versão atual.",
    );
  }
}

function createRemoteStorage(key: string, grantId: string, onDepartureSaved: () => void) {
  const kind = stateKindSchema.parse(key);
  let revision = 0;
  let conflicted: StateConflict | null = null;
  const headers = { [employeeGrantHeader]: grantId };

  async function read() {
    const result = await getEmployeeApi().api.employee.state({ key: kind }).get({ headers });

    if (result.error) throw new Error("Não foi possível sincronizar.");

    const state = employeeStateSchema.parse(result.data);

    return { revision: state.revision, value: JSON.stringify(state.value) };
  }

  return {
    async read() {
      const state = await read();

      return {
        value: state.value,
        accept: () => {
          revision = state.revision;
        },
      };
    },
    async write(draft: string) {
      if (conflicted) throw conflicted;

      const body = employeeStateSchema.parse({ key: kind, revision, value: JSON.parse(draft) });
      const result = await getEmployeeApi().api.employee.state.put(body, { headers });

      if (result.status === 409) {
        const current = await read();
        revision = current.revision;
        conflicted = new StateConflict(current.value);
        throw conflicted;
      }

      if (result.error) throw new Error("Não foi possível sincronizar.");

      revision = result.data.revision;

      if (kind === "departure-v1") onDepartureSaved();
    },
    discard() {
      conflicted = null;
    },
  };
}

function createEntry(key: string, remote?: ReturnType<typeof createRemoteStorage>) {
  let snapshot: Snapshot = { value: null, status: "loading" };
  let started = false;
  let writeQueue = Promise.resolve(true);
  let revision = 0;
  let refreshedAt = 0;
  let loading = false;
  let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
  const listeners = new Set<() => void>();

  function publish(next: Snapshot) {
    snapshot = next;

    for (const listener of listeners) listener();
  }

  async function load() {
    publish({ value: null, status: "loading" });

    try {
      const result = await remote?.read();
      const value = result ? result.value : await AsyncStorage.getItem(key);

      result?.accept();
      refreshedAt = Date.now();
      publish({ value, status: "ready" });
    } catch {
      publish({ value: null, status: "read-error" });
    }
  }

  async function refresh() {
    if (!remote || loading || snapshot.status !== "ready") return;

    loading = true;
    const version = revision;

    try {
      const result = await remote.read();

      if (revision === version && snapshot.status === "ready") {
        result.accept();
        refreshedAt = Date.now();
        publish({ value: result.value, status: "ready" });
      }
    } catch {
      return;
    } finally {
      loading = false;
    }
  }

  function save(draft: string, errorMessage = writeError) {
    revision += 1;
    const currentRevision = revision;
    publish({ value: snapshot.value, draft, errorMessage, status: "saving" });
    writeQueue = writeQueue.then(async () => {
      try {
        if (remote) await remote.write(draft);
        else await AsyncStorage.setItem(key, draft);

        if (revision === currentRevision) {
          publish({ value: draft, status: "ready" });
        } else {
          publish({ ...snapshot, value: draft });
        }

        return true;
      } catch (error) {
        if (revision === currentRevision) {
          const conflict = error instanceof StateConflict ? error : null;

          publish({
            value: conflict?.currentValue ?? snapshot.value,
            draft,
            errorMessage: conflict?.message ?? errorMessage,
            status: "save-error",
          });
        }

        return false;
      }
    });

    return writeQueue;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);

      if (!started) {
        started = true;
        void load();
      } else if (remote && Date.now() - refreshedAt > 30_000) {
        void refresh();
      }

      if (remote && !subscription) {
        subscription = AppState.addEventListener("change", (next) => {
          if (next === "active") void refresh();
        });
      }

      return () => {
        listeners.delete(listener);

        if (!listeners.size) {
          subscription?.remove();
          subscription = undefined;
        }
      };
    },
    save,
    retry() {
      if (snapshot.status === "read-error") void load();

      if (snapshot.status === "save-error") return save(snapshot.draft, snapshot.errorMessage);
    },
    discardFailedWrite() {
      if (snapshot.status === "save-error") {
        remote?.discard();
        publish({ value: snapshot.value, status: "ready" });
      }
    },
  };
}

type StorageEntry = ReturnType<typeof createEntry>;

function createStorage(
  namespace: string,
  grantId: string | undefined,
  onDepartureSaved: () => void,
) {
  const entries = new Map<string, StorageEntry>();

  return (key: string) => {
    const existing = entries.get(key);

    if (existing) return existing;

    const entry = createEntry(
      `offboard:employee:v1:${namespace}:${key}`,
      grantId ? createRemoteStorage(key, grantId, onDepartureSaved) : undefined,
    );

    entries.set(key, entry);

    return entry;
  };
}

const StorageContext = createContext<ReturnType<typeof createStorage> | null>(null);

export function LocalDataProvider({
  namespace,
  grantId,
  children,
}: {
  namespace: string;
  grantId?: string;
  children: ReactNode;
}) {
  return (
    <AccountStorage key={namespace} namespace={namespace} grantId={grantId}>
      {children}
    </AccountStorage>
  );
}

function AccountStorage({
  namespace,
  grantId,
  children,
}: {
  namespace: string;
  grantId?: string;
  children: ReactNode;
}) {
  const client = useQueryClient();

  const [storage] = useState(() =>
    createStorage(namespace, grantId, () => {
      void client.invalidateQueries({ queryKey: [...employeeJourneyQueryKey, namespace] });
    }),
  );

  return <StorageContext.Provider value={storage}>{children}</StorageContext.Provider>;
}

function parseValue<T>(value: string, schema: ZodType<T>, initial: T) {
  try {
    const result = schema.safeParse(JSON.parse(value));

    if (result.success) return result.data;
  } catch {
    return initial;
  }

  return initial;
}

export function useLocalData<T>(
  key: string,
  schema: ZodType<T>,
  initial: T,
  visibility: WriteVisibility = "optimistic",
) {
  const storage = use(StorageContext);

  if (!storage) throw new Error("LocalDataProvider is required");

  const entry = storage(key);
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  const value = visibleValue(snapshot, visibility);

  const data = useMemo(
    () => (value === null ? initial : parseValue(value, schema, initial)),
    [value, schema, initial],
  );

  const loading = snapshot.status === "loading";
  const saving = snapshot.status === "saving";

  const error =
    snapshot.status === "read-error"
      ? readError
      : snapshot.status === "save-error"
        ? snapshot.errorMessage
        : null;

  function update(change: (previous: T) => T, options?: { errorMessage: string }) {
    const current = entry.getSnapshot();

    if (current.status === "loading" || current.status === "read-error") return;

    if (visibility === "confirmed" && current.status === "saving") return;

    const previousValue = visibleValue(current, visibility);
    const previous = previousValue === null ? initial : parseValue(previousValue, schema, initial);

    return entry.save(JSON.stringify(change(previous)), options?.errorMessage);
  }

  return [
    data,
    update,
    {
      loading,
      saving,
      readFailed: snapshot.status === "read-error",
      pending: loading || saving,
      error,
      retry: entry.retry,
      discardFailedWrite: entry.discardFailedWrite,
    },
  ] as const;
}
