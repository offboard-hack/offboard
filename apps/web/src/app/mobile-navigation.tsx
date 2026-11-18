import { Drawer } from "@base-ui/react/drawer";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { portalStyles } from "../shared/ui/surface.styles";
import { colors, elevation, motion } from "../shared/ui/theme.stylex";
import { shellStyles } from "./shell.styles";

const animate = "@media (prefers-reduced-motion: no-preference)";
const closing = ":is([data-starting-style], [data-ending-style])";

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 4,
    backgroundColor: colors.overlay,
    opacity: { default: "calc(1 - var(--drawer-swipe-progress, 0))", [closing]: 0 },
    transitionProperty: { default: null, [animate]: "opacity" },
    transitionDuration: { default: null, [animate]: motion.popup },
  },
  viewport: { position: "fixed", inset: 0, zIndex: 5, pointerEvents: "none" },
  popup: {
    pointerEvents: "auto",
    width: "min(21rem, calc(100vw - 3rem))",
    height: "100%",
    backgroundColor: colors.sidebar,
    boxShadow: elevation.drawer,
    display: "flex",
    flexDirection: "column",
    translate: { default: "var(--drawer-swipe-movement-x, 0px) 0", [closing]: "-100% 0" },
    transitionProperty: { default: null, [animate]: "translate" },
    transitionDuration: {
      default: null,
      [animate]: `calc(${motion.drawer} * var(--drawer-swipe-strength, 1))`,
      ":is([data-swiping])": "0ms",
    },
    transitionTimingFunction: motion.easeOut,
  },
  content: {
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    touchAction: "pan-y",
    padding: "0.75rem 0.875rem max(1rem, env(safe-area-inset-bottom))",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.75rem 0.875rem 0.75rem 1.5rem",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  close: {
    width: "2.75rem",
    padding: 0,
    WebkitTapHighlightColor: "transparent",
  },
});

export function MobileNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const watchDesktop = useCallback((popup: HTMLElement | null) => {
    if (!popup) {
      return;
    }

    const desktop = window.matchMedia("(min-width: 52.001rem)");

    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) {
        setOpen(false);
      }
    }

    desktop.addEventListener("change", closeOnDesktop);

    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="left">
      <Drawer.Trigger
        aria-label="Menu do portal"
        {...stylex.props(
          portalStyles.button,
          portalStyles.secondaryButton,
          shellStyles.navigationTrigger,
        )}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 4.5h11m-11 3.5h11m-11 3.5h11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Menu
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop {...stylex.props(styles.backdrop)} />
        <Drawer.Viewport {...stylex.props(styles.viewport)}>
          <Drawer.Popup ref={watchDesktop} {...stylex.props(styles.popup)}>
            <div {...stylex.props(styles.header)}>
              <Drawer.Title {...stylex.props(portalStyles.subheading)}>
                Seções do portal
              </Drawer.Title>
              <Drawer.Close
                aria-label="Fechar menu"
                {...stylex.props(portalStyles.button, portalStyles.secondaryButton, styles.close)}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="m4 4 8 8m0-8-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </Drawer.Close>
            </div>
            <Drawer.Content {...stylex.props(styles.content)}>{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
