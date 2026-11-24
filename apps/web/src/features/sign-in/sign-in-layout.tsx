import type { ReactNode } from "react";
import { SignInVisual } from "./sign-in-visual";

export function SignInLayout({
  title,
  description,
  visualDescription,
  secondaryLink,
  children,
}: {
  title: string;
  description: string;
  visualDescription?: string;
  secondaryLink?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-svh grid-rows-[auto_1fr] bg-background p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-1 md:p-4">
      <SignInVisual description={visualDescription} />
      <section className="mx-auto grid w-full max-w-96 content-start gap-4 px-3 py-6 md:my-auto md:w-[calc(100%_-_4rem)] md:px-0 md:py-12">
        <svg
          role="img"
          aria-label="Offboard"
          viewBox="0 0 877 256"
          className="h-10 w-auto fill-foreground text-primary"
        >
          <use href="/offboard-logo.svg#wordmark" />
        </svg>
        <div className="grid gap-7">
          <div className="grid gap-3">
            <h1 className="text-[clamp(1.6rem,3vw,1.9rem)] leading-none font-[730] tracking-tight">
              {title}
            </h1>
            <p className="max-w-[36ch] text-base/relaxed text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
        {secondaryLink ? <div className="border-t pt-4 text-sm">{secondaryLink}</div> : null}
      </section>
    </main>
  );
}
