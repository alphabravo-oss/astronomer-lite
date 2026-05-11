import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

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

  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  if (!open) return null;

  const canConfirm = confirmValue ? inputValue === confirmValue : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} aria-label="Close dialog" />
      <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="p-6">
          <div className="flex items-start gap-3">
            {variant === "destructive" ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              {confirmValue ? (
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Type <span className="font-mono font-medium text-foreground">{confirmValue}</span> to confirm
                  </label>
                  <input
                    id="confirm-dialog-value"
                    name="confirm-value"
                    type="text"
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
                    placeholder={confirmValue}
                    autoFocus
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-8 items-center rounded px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
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
        </div>
      </div>
    </div>
  );
}
