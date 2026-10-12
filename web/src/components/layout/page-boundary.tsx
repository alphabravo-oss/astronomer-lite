import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { PageHeader, PageShell } from "../ui/page";

export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <PageShell>
        <PageHeader
          title="This page could not be displayed"
          description="Reload to try again, or return to your clusters."
        />
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Link className="text-sm underline" to="/">
            Back to clusters
          </Link>
        </div>
      </PageShell>
    );
  }
}
