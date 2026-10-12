import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

declare global {
  interface Window {
    astronomerDesktop?: {
      onOpenSettings: (callback: () => void) => () => void;
    };
  }
}

/** Native menu navigation shares the router and preserves live workspace state. */
export function useDesktopNavigation() {
  const navigate = useNavigate();
  useEffect(
    () => window.astronomerDesktop?.onOpenSettings(() => navigate("/settings")),
    [navigate],
  );
}
