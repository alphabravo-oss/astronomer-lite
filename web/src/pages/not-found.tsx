import { Link } from "react-router-dom";
import { PageHeader, PageShell } from "../components/ui/page";

export function NotFoundPage() {
  return (
    <PageShell>
      <PageHeader
        title="Page not found"
        description="This address does not match a page in Astronomer Lite."
      />
      <Link className="text-sm underline" to="/">
        Back to clusters
      </Link>
    </PageShell>
  );
}
