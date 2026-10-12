import { Check, Plus, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/input";
import {
  accessStatusMessage,
  isAccessBlocked,
  type AccessCheck,
} from "../../lib/access";
import type { ApplyResponse } from "../../lib/api";
import { cn } from "../../lib/utils";

export function CreateYamlDialog({
  open,
  yaml,
  validated,
  state,
  error,
  response,
  access,
  onYamlChange,
  onDryRun,
  onApply,
  onClose,
}: {
  open: boolean;
  yaml: string;
  validated: boolean;
  state: "idle" | "dry-running" | "applying";
  error: string;
  response: ApplyResponse | null;
  access: AccessCheck;
  onYamlChange: (value: string) => void;
  onDryRun: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && state === "idle") onClose();
      }}
    >
      <DialogContent
        showClose={false}
        className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create YAML
            </DialogTitle>
            <DialogDescription className="mt-1">
              Dry-run the manifest against Kubernetes before applying it.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={state !== "idle"}
            aria-label="Close create YAML dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Textarea
            id="create-resource-yaml"
            name="create-resource-yaml"
            value={yaml}
            onChange={(event) => onYamlChange(event.target.value)}
            className="min-h-[26rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-hidden focus:ring-2 focus:ring-ring"
            autoFocus
          />
          {error ? (
            <div className="mt-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {response ? (
            <div
              className={cn(
                "mt-3 rounded-md border p-3 text-sm",
                response.dryRun
                  ? "border-status-warning/35 bg-status-warning/10 text-status-warning"
                  : "border-status-success/35 bg-status-success/10 text-status-success",
              )}
            >
              <div className="mb-2 flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" />
                {response.dryRun ? "Dry run passed" : "Applied"} for{" "}
                {response.items.length} resource
                {response.items.length === 1 ? "" : "s"}.
              </div>
              <div className="flex flex-wrap gap-2">
                {response.items.map((item) => (
                  <span
                    key={`${item.apiVersion}/${item.kind}/${item.namespace ?? "_cluster"}/${item.name}`}
                    className="rounded-md bg-background/70 px-2 py-1 font-mono text-xs"
                  >
                    {item.kind}/{item.namespace ? `${item.namespace}/` : ""}
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={state !== "idle"}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={onDryRun}
            disabled={
              state !== "idle" || !yaml.trim() || isAccessBlocked(access)
            }
            title={accessStatusMessage(access) || undefined}
          >
            {state === "dry-running" ? "Dry-running..." : "Dry run"}
          </Button>
          <Button
            onClick={onApply}
            disabled={state !== "idle" || !validated || isAccessBlocked(access)}
            title={accessStatusMessage(access) || undefined}
          >
            {state === "applying" ? "Applying..." : "Apply"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
