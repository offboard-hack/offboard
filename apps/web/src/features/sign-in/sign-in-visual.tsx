import { MeshGradient } from "@paper-design/shaders-react";
import { useHydrated } from "@tanstack/react-router";
import { useCallback, useState, useSyncExternalStore } from "react";
import { TextMorph } from "torph/react";

const captions = [
  "Cuidado em cada transição.",
  "Clareza em cada etapa.",
  "Apoio para o próximo passo.",
];

const colors = ["#18092f", "#32126a", "#642ad2", "#bf9bf4", "#462182", "#251047"];
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);

  return () => preference.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function prefersStaticServerPreview() {
  return true;
}

export function SignInVisual() {
  const hydrated = useHydrated();

  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    prefersStaticServerPreview,
  );

  const [index, setIndex] = useState(0);

  const rotateCaptions = useCallback(
    (element: HTMLSpanElement | null) => {
      if (!element || reducedMotion) return;

      const timer = window.setInterval(() => {
        setIndex((current) => (current + 1) % captions.length);
      }, 3200);

      return () => window.clearInterval(timer);
    },
    [reducedMotion],
  );

  return (
    <aside
      aria-label="Mensagem do Offboard"
      className="relative isolate grid min-h-50 items-end overflow-hidden rounded-2xl bg-[#25114d] p-5 md:min-h-[calc(100svh-2rem)] md:p-[clamp(1.5rem,5vw,5rem)]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-145 from-[#260f50] via-[#49217b] to-[#1c0b3c]"
      >
        {hydrated && (
          <MeshGradient
            width="100%"
            height="100%"
            colors={colors}
            distortion={0.74}
            swirl={0.26}
            grainMixer={0}
            grainOverlay={0}
            speed={reducedMotion ? 0 : 0.48}
            frame={2400}
            minPixelRatio={1}
            maxPixelCount={650_000}
          />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-[#17072fbb] via-transparent to-[#18092ea8]" />
      </div>
      <div className="grid max-w-104 gap-2">
        <p className="text-[clamp(1.25rem,2vw,2rem)] leading-[1.15] font-[750] tracking-[-0.015em] text-white">
          <span className="sr-only">{captions[0]}</span>
          <span ref={rotateCaptions} aria-hidden="true" className="grid">
            {captions.map((caption) => (
              <span key={caption} className="invisible col-start-1 row-start-1">
                {caption}
              </span>
            ))}
            <span className="col-start-1 row-start-1">
              {reducedMotion ? (
                captions[0]
              ) : (
                <TextMorph duration={280} locale="pt-BR">
                  {captions[index]}
                </TextMorph>
              )}
            </span>
          </span>
        </p>
        <p className="max-w-[34ch] text-sm/relaxed text-white/80 md:text-base/relaxed">
          Organize os desligamentos e acompanhe os próximos passos da sua equipe.
        </p>
      </div>
    </aside>
  );
}
