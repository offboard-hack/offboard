const sessionChangeKey = "offboard-session-change";

export function notifySessionChange() {
  try {
    localStorage.setItem(sessionChangeKey, crypto.randomUUID());
  } catch {
    return;
  }
}

export function subscribeToSessionChanges(refresh: () => void) {
  function refreshOnStorage(event: StorageEvent) {
    if (event.key === sessionChangeKey) refresh();
  }

  window.addEventListener("focus", refresh);
  window.addEventListener("storage", refreshOnStorage);

  return () => {
    window.removeEventListener("focus", refresh);
    window.removeEventListener("storage", refreshOnStorage);
  };
}
