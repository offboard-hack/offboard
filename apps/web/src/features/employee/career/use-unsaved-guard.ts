import { useBlocker } from "@tanstack/react-router";

export function useUnsavedGuard(dirty: boolean) {
  useBlocker({
    shouldBlockFn: () => !window.confirm("Você tem alterações não salvas. Sair e descartá-las?"),
    enableBeforeUnload: () => dirty,
    disabled: !dirty,
  });
}
