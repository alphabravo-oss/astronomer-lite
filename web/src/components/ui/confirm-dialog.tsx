import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  confirmValue?: string;
  variant?: "destructive";
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Delete",
  confirmValue,
  variant,
  loading,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);

  const canConfirm = confirmValue ? inputValue === confirmValue : true;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={
          confirmValue
            ? (event) => {
                // Type-to-confirm: land the cursor in the input instead of
                // Radix's default focus on Cancel, matching the original UX.
                event.preventDefault();
                inputRef.current?.focus();
              }
            : undefined
        }
      >
        <div className="flex items-start gap-3">
          {variant === "destructive" ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            {confirmValue ? (
              <div className="mt-4">
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  Type <span className="font-mono font-medium text-foreground">{confirmValue}</span> to confirm
                </label>
                <input
                  ref={inputRef}
                  id="confirm-dialog-value"
                  name="confirm-value"
                  type="text"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  className="h-8 w-full rounded border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder={confirmValue}
                />
              </div>
            ) : null}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={loading}
            className="inline-flex h-8 items-center rounded px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </AlertDialogCancel>
          <button
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              variant === "destructive"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {confirmText}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
