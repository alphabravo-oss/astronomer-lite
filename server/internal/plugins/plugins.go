package plugins

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

type Registry struct {
	providers []Provider
}

func (r *Registry) Register(provider Provider) {
	r.providers = append(r.providers, provider)
}

func (r *Registry) NavItems() []NavItem {
	var items []NavItem
	for _, provider := range r.providers {
		items = append(items, provider.NavItems()...)
	}
	return items
}

type staticProvider struct {
	id    string
	items []NavItem
}

func (p staticProvider) ID() string {
	return p.id
}

func (p staticProvider) NavItems() []NavItem {
	return append([]NavItem(nil), p.items...)
}

func DefaultRegistry() *Registry {
	registry := &Registry{}
	registry.Register(staticProvider{
		id: "core",
		items: []NavItem{
			{ID: "dashboard", Label: "Dashboard", Route: "", Group: "Cluster"},
			{ID: "api-resources", Label: "API Resources", Route: "resources", Group: "Cluster"},
			{ID: "metrics", Label: "Metrics", Route: "metrics", Group: "Cluster"},
			{ID: "events", Label: "Events", Route: "events", Group: "Cluster"},
			{ID: "nodes", Label: "Nodes", Route: "nodes", Group: "Cluster"},
			{ID: "namespaces", Label: "Namespaces", Route: "namespaces", Group: "Cluster"},
			{ID: "pods", Label: "Pods", Route: "pods", Group: "Workloads"},
			{ID: "deployments", Label: "Deployments", Route: "deployments", Group: "Workloads"},
			{ID: "replicasets", Label: "ReplicaSets", Route: "replicasets", Group: "Workloads"},
			{ID: "daemonsets", Label: "DaemonSets", Route: "daemonsets", Group: "Workloads"},
			{ID: "statefulsets", Label: "StatefulSets", Route: "statefulsets", Group: "Workloads"},
			{ID: "jobs", Label: "Jobs", Route: "jobs", Group: "Workloads"},
			{ID: "cronjobs", Label: "CronJobs", Route: "cronjobs", Group: "Workloads"},
			{ID: "services", Label: "Services", Route: "services", Group: "Service Discovery"},
			{ID: "endpoints", Label: "Endpoints", Route: "endpoints", Group: "Service Discovery"},
			{ID: "ingresses", Label: "Ingresses", Route: "ingresses", Group: "Service Discovery"},
			{ID: "persistentvolumes", Label: "PersistentVolumes", Route: "persistentvolumes", Group: "Storage"},
			{ID: "persistentvolumeclaims", Label: "PVCs", Route: "persistentvolumeclaims", Group: "Storage"},
			{ID: "storageclasses", Label: "StorageClasses", Route: "storageclasses", Group: "Storage"},
			{ID: "configmaps", Label: "ConfigMaps", Route: "configmaps", Group: "Storage"},
			{ID: "secrets", Label: "Secrets", Route: "secrets", Group: "Storage"},
			{ID: "networkpolicies", Label: "Network Policies", Route: "networkpolicies", Group: "Policy"},
			{ID: "poddisruptionbudgets", Label: "PDB", Route: "poddisruptionbudgets", Group: "Policy"},
			{ID: "serviceaccounts", Label: "ServiceAccounts", Route: "serviceaccounts", Group: "More Resources"},
			{ID: "roles", Label: "Roles", Route: "roles", Group: "More Resources"},
			{ID: "rolebindings", Label: "RoleBindings", Route: "rolebindings", Group: "More Resources"},
			{ID: "clusterroles", Label: "ClusterRoles", Route: "clusterroles", Group: "More Resources"},
			{ID: "clusterrolebindings", Label: "ClusterRoleBindings", Route: "clusterrolebindings", Group: "More Resources"},
			{ID: "crds", Label: "CRDs", Route: "crds", Group: "More Resources"},
		},
	})
	return registry
}
