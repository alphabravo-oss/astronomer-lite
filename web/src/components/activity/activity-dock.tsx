import { ExternalLink, FileText, Network, Pencil, ScrollText, Terminal, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useActivities, type ActivityKind } from "../../lib/activities-context";
import { cn } from "../../lib/utils";

const ICONS: Record<ActivityKind, typeof ScrollText> = {
  logs: ScrollText,
  exec: Terminal,
  attach: Terminal,
  yaml: Pencil,
  "port-forward": Network
};

export function ActivityDock() {
  const { activities, unpin } = useActivities();
  if (activities.length === 0) return null;
  return (
    <div className="border-t border-border bg-card/95 px-3 py-1.5 backdrop-blur">
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-3 w-3" /> Dock
        </span>
        {activities.map((activity) => {
          const Icon = ICONS[activity.kind] ?? ScrollText;
          return (
            <div
              key={activity.id}
              className={cn(
                "group inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
              )}
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <Link to={activity.href} className="font-medium text-foreground hover:underline">
                {activity.label}
              </Link>
              {activity.detail ? <span className="hidden truncate text-muted-foreground sm:inline">{activity.detail}</span> : null}
              <Link to={activity.href} className="text-muted-foreground hover:text-foreground" aria-label="Open in main view">
                <ExternalLink className="h-3 w-3" />
              </Link>
              <button
                type="button"
                onClick={() => unpin(activity.id)}
                aria-label={`Remove ${activity.label} from dock`}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
