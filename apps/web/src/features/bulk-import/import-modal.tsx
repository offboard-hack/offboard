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
import { Spinner } from "@/shared/ui/shadcn/spinner";

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
              <p role="status" className="flex items-center gap-2">
                <Spinner aria-hidden="true" />
                Carregando importação…
              </p>
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
