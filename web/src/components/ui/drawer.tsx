import { useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "./dialog";
import { cn } from "../../lib/utils";

/** Resource details share modal focus, Escape dismissal and viewport sizing. */
export function Drawer({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [returnFocus] = useState(() => document.activeElement);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
              returnFocus.focus();
          }}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl focus:outline-hidden data-[state=open]:animate-slide-in-right",
            className,
          )}
        >
          <DialogTitle asChild>
            <span className="sr-only">{title}</span>
          </DialogTitle>
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
