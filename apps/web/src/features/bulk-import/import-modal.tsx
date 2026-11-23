import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";

export function ImportModal({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Upload01Icon} aria-hidden="true" />
        Importar
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Importar desligamentos
          </DialogTitle>
          <DialogDescription className="text-base">
            Use as colunas nome e departamento.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Suspense
            fallback={
              <div>
                <p role="status" className="sr-only">
                  Carregando importação…
                </p>
                <div
                  aria-hidden="true"
                  className="grid justify-items-center gap-3 rounded-2xl border border-dashed p-6"
                >
                  <Skeleton className="size-10 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-48 max-w-full" />
                  <Skeleton className="mt-1 h-9 w-32 rounded-full" />
                </div>
              </div>
            }
          >
            {children}
          </Suspense>
        </DialogBody>
        <DialogFooter className="sm:justify-start">
          <p className="text-muted-foreground">
            Os desligamentos não são cadastrados nesta revisão.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
