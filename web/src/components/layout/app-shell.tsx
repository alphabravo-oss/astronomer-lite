import { Outlet, useParams } from "react-router-dom";
import { useState } from "react";
import type { Cluster } from "../../lib/api";
import { ActivityProvider } from "../../lib/activities";
import { ActivityDock } from "../activity/activity-dock";
import { MobileSidebarDrawer, Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "../palette/command-palette";

type AppShellProps = {
  clusters: Cluster[];
  onRefresh: () => void;
  selectedNamespaces: string[];
  onSelectedNamespacesChange: (namespaces: string[]) => void;
};

export function AppShell({ clusters, onRefresh, selectedNamespaces, onSelectedNamespacesChange }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { clusterId } = useParams();

  return (
    <ActivityProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar clusters={clusters} />
        <MobileSidebarDrawer clusters={clusters} open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar
            clusters={clusters}
            onRefresh={onRefresh}
            selectedNamespaces={selectedNamespaces}
            onSelectedNamespacesChange={onSelectedNamespacesChange}
            onOpenMobileNav={() => setMobileSidebarOpen(true)}
          />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1600px] animate-fade-in p-4 md:p-6">
              <Outlet />
            </div>
          </main>
          <ActivityDock />
          <div id="bottom-panel-root" className="shrink-0" />
        </div>
        <CommandPalette clusters={clusters} activeClusterId={clusterId} />
      </div>
    </ActivityProvider>
  );
}
