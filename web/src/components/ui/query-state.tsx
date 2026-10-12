import { Card } from "./card";
import type { ReactNode } from "react";
import { Button } from "./button";

export function QueryState({
  loading,
  error,
  empty,
  children,
  onRetry,
  action,
}: {
  loading?: boolean;
  error?: string;
  empty?: string;
  children?: ReactNode;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  if (loading)
    return (
      <Card role="status" className="text-sm text-muted-foreground">
        Loading…
      </Card>
    );
  if (error)
    return (
      <Card
        role="alert"
        className="space-y-3 wrap-anywhere border-status-error/30 bg-status-error/10 text-sm"
      >
        <p>{error}</p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Card>
    );
  if (empty)
    return (
      <Card className="space-y-3 text-sm text-muted-foreground">
        <p>{empty}</p>
        {action}
      </Card>
    );
  return children;
}
