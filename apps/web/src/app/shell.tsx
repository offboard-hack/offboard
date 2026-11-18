import * as stylex from "@stylexjs/stylex";
import type { ReactNode, Ref } from "react";
import { shellStyles as s } from "./shell.styles";

export function PortalLayout({
  children,
  navigation,
  mainRef,
}: {
  children: ReactNode;
  navigation: ReactNode;
  mainRef: Ref<HTMLElement>;
}) {
  return (
    <div {...stylex.props(s.portal)}>
      <a {...stylex.props(s.skipLink)} href="#conteudo">
        Ir para o conteúdo
      </a>
      <aside {...stylex.props(s.sidebar)}>
        <div {...stylex.props(s.wordmark)}>
          <span {...stylex.props(s.wordmarkIcon)} data-brand-mark aria-hidden="true">
            <span {...stylex.props(s.wordmarkGlyph)} />
          </span>
          <div>
            Offboard
            <span {...stylex.props(s.wordmarkNote)}>Portal do RH</span>
          </div>
        </div>
        {navigation}
      </aside>
      <div>
        <header {...stylex.props(s.topbar)}>
          <span {...stylex.props(s.organization)}>Aurora Tecnologia</span>
          <span {...stylex.props(s.demoLabel)}>Modo demonstração</span>
        </header>
        <main ref={mainRef} id="conteudo" {...stylex.props(s.main)} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
