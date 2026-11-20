import type { ReactNode, Ref } from "react";
import { useDropzone } from "react-dropzone";
import type { DropzoneOptions, FileRejection } from "react-dropzone";
import { Button } from "./button";
import { cn } from "@/shared/lib/utils";

/** Adapted from the Kibo UI Dropzone registry component for Base UI and a separate file-picker button. */
export function Dropzone({
  accept,
  maxSize,
  onFile,
  onReject,
  buttonRef,
  describedBy,
  label,
  children,
}: {
  accept: DropzoneOptions["accept"];
  maxSize: number;
  onFile: (file: File) => void;
  onReject: (rejections: FileRejection[]) => void;
  buttonRef?: Ref<HTMLButtonElement>;
  describedBy?: string;
  label: string;
  children: ReactNode;
}) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept,
    maxSize,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: ([file]) => {
      if (file) onFile(file);
    },
    onDropRejected: onReject,
  });

  return (
    <div
      {...getRootProps({
        className: cn(
          "grid min-h-56 content-center justify-items-center gap-4 rounded-2xl border border-dashed border-input bg-muted/30 px-4 py-7 text-center sm:min-h-64",
          isDragActive && "border-primary bg-primary/10 ring-1 ring-primary/25",
        ),
      })}
    >
      <input {...getInputProps({ "aria-hidden": true, hidden: true })} />
      {children}
      <Button
        ref={buttonRef}
        className="min-h-11 px-5"
        onClick={open}
        aria-describedby={describedBy}
      >
        {label}
      </Button>
    </div>
  );
}
