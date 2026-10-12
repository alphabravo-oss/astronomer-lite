import type { ReactNode } from "react";
import { Button } from "./button";

export function QueryState({ loading, error, empty, children, onRetry, action }: {
 loading?: boolean; error?: string; empty?: string; children?: ReactNode; onRetry?: () => void; action?: ReactNode;
}) {
 if (loading) return <p role="status" className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Loading…</p>;
 if (error) return <div role="alert" className="space-y-3 rounded-lg border border-status-error/30 bg-status-error/10 p-5 text-sm"><p>{error}</p>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}</div>;
 if (empty) return <div className="space-y-3 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground"><p>{empty}</p>{action}</div>;
 return children;
}
