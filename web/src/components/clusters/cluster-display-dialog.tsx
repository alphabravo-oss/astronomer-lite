import { useEffect, useState } from "react";
import type { Cluster, DisplayColor } from "../../lib/api";
import { DISPLAY_PALETTE, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ClusterChip } from "./cluster-chip";
import { clusterChipColorClass } from "./cluster-chip-colors";

type Props = {
  cluster: Cluster | null;
  onClose: () => void;
  onSaved: (updated: Cluster) => void;
};

export function ClusterDisplayDialog({ cluster, onClose, onSaved }: Props) {
  const [color, setColor] = useState<string>(cluster?.displayColor ?? "blue");
  const [initials, setInitials] = useState<string>(cluster?.displayInitials ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cluster) {
      setColor(cluster.displayColor);
      setInitials(cluster.displayInitials);
      setError("");
    }
  }, [cluster]);

  useEffect(() => {
    if (!cluster) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, cluster]);

  if (!cluster) return null;

  async function save(payload: { color?: string; initials?: string }) {
    setBusy(true);
    setError("");
    try {
      const updated = await api.updateClusterDisplay(cluster!.id, payload);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update display");
    } finally {
      setBusy(false);
    }
  }

  const trimmedInitials = initials.toUpperCase().slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} aria-label="Close dialog" />
      <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="p-5">
          <h2 className="text-lg font-semibold">Customize cluster appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">{cluster.name}</p>

          <div className="mt-5 flex items-center gap-4">
            <ClusterChip cluster={{ name: cluster.name, displayColor: color as DisplayColor, displayInitials: trimmedInitials || cluster.displayInitials }} size="lg" />
            <div className="flex-1">
              <label htmlFor="cluster-initials" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Initials
              </label>
              <input
                id="cluster-initials"
                type="text"
                maxLength={3}
                value={initials}
                onChange={(event) => setInitials(event.target.value.toUpperCase())}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={cluster.displayInitials}
              />
              <p className="mt-1 text-xs text-muted-foreground">Max 3 characters. Leave blank to auto-derive from name.</p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Color</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DISPLAY_PALETTE.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  className={cn(
                    "h-8 w-8 rounded-md border-2 transition-all",
                    clusterChipColorClass(option),
                    color === option ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                  )}
                  aria-label={option}
                  title={option}
                />
              ))}
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-background/50 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => save({ color: "", initials: "" })} disabled={busy}>
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => save({ color, initials: trimmedInitials })} disabled={busy}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
