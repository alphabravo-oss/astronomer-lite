import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import type { Cluster } from "../../lib/api";
import { ActivityProvider } from "../../lib/activities";
import { ActivityDock } from "../activity/activity-dock";
import { CommandPalette } from "../command-palette";
import { MobileSidebarDrawer, Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

type AppShellProps = {
  clusters: Cluster[];
  onRefresh: () => void;
  selectedNamespaces: string[];
  onSelectedNamespacesChange: (namespaces: string[]) => void;
};

export function AppShell({ clusters, onRefresh, selectedNamespaces, onSelectedNamespacesChange }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the palette from anywhere in the shell.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ActivityProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <a href="#main-content" className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
        <Sidebar clusters={clusters} />
        <MobileSidebarDrawer clusters={clusters} open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar
            clusters={clusters}
            onRefresh={onRefresh}
            selectedNamespaces={selectedNamespaces}
            onSelectedNamespacesChange={onSelectedNamespacesChange}
            onOpenMobileNav={() => setMobileSidebarOpen(true)}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          />
          <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-hidden">
            <div className="mx-auto max-w-[1600px] animate-fade-in p-4 md:p-6">
              <Outlet />
            </div>
          </main>
          <ActivityDock />
          <div id="bottom-panel-root" className="shrink-0" />
        </div>
        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} clusters={clusters} />
      </div>
    </ActivityProvider>
  );
}
