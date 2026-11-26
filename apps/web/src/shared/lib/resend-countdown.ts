import { useCallback, useSyncExternalStore } from "react";

export const resendCooldownSeconds = 30;

export function useResendCountdown(resendAt: number) {
  const subscribe = useCallback(
    (tick: () => void) => {
      const timer = window.setInterval(() => {
        tick();

        if (Date.now() >= resendAt) window.clearInterval(timer);
      }, 250);

      return () => window.clearInterval(timer);
    },
    [resendAt],
  );

  return useSyncExternalStore(
    subscribe,
    () => Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)),
    () => resendCooldownSeconds,
  );
}
