# Astronomer-lite Plugin Seam

Astronomer-lite does not load external plugins in the MVP. Internal pages are registered through plugin-shaped interfaces so a future loader can attach without changing routing or navigation contracts.

## Frontend

```ts
export type NavItemPlugin = {
  id: string;
  label: string;
  route: string;
  group: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type ResourcePagePlugin = NavItemPlugin & {
  element: React.ReactNode;
};

export type ResourceActionPlugin<TResource = unknown> = {
  id: string;
  label: string;
  resource: string;
  render: (resource: TResource) => React.ReactNode;
  isVisible?: (resource: TResource) => boolean;
};
```

Internal pages should be added to the registry, not hard-coded across unrelated components. The Vite router and sidebar both consume the same registry entries, so removing an internal page registration removes both its route and navigation entry.

Resource actions are intentionally registered through a separate seam. The MVP does not load external actions yet, but future actions can target one resource route or GVR without changing the core resource drawer contract.

## Backend

```go
type NavItem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Route string `json:"route"`
	Group string `json:"group"`
}

type Provider interface {
	ID() string
	NavItems() []NavItem
}
```

The current backend exposes `/api/plugins/nav` from a static internal registry. External loading, sandboxing, signatures, and a plugins runtime directory are intentionally out of scope for this spec.
