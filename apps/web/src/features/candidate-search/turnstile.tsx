import { useCallback } from "react";

type TurnstileOptions = {
  sitekey: string;
  language: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading: Promise<TurnstileApi> | undefined;

function loadTurnstile() {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");

    script.src = scriptUrl;
    script.async = true;

    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile did not load"));
    };

    script.onerror = () => {
      loading = undefined;
      reject(new Error("Turnstile did not load"));
    };

    document.head.appendChild(script);
  });

  return loading;
}

export function Turnstile({
  siteKey,
  onToken,
  onUnavailable,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return undefined;

      const widget = { id: "", removed: false };

      loadTurnstile()
        .then((api) => {
          if (widget.removed) return;

          widget.id = api.render(node, {
            sitekey: siteKey,
            language: "pt-br",
            callback: (token) => onToken(token),
            "expired-callback": () => onToken(null),
            "error-callback": () => onToken(null),
          });
        })
        .catch(onUnavailable);

      return () => {
        widget.removed = true;
        onToken(null);

        if (widget.id) window.turnstile?.remove(widget.id);
      };
    },
    [siteKey, onToken, onUnavailable],
  );

  return <div ref={mount} className="min-h-[65px]" />;
}
