// A deliberately scoped Headlamp UMD compatibility profile. It lives entirely
// inside the existing opaque plugin frame and uses the same permission broker.
import React, { useEffect, useState, useSyncExternalStore } from "react";
import * as ReactJSX from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as MuiMaterial from "@mui/material";
import * as ReactRouter from "react-router-dom";

const {
  Box,
  Typography,
  Paper,
  Alert,
  ThemeProvider,
  createTheme,
  CssBaseline,
} = MuiMaterial;
const { MemoryRouter, Route, Switch, Link, Redirect } = ReactRouter;
const routes = [],
  sidebar = [],
  actions = [],
  settings = [],
  filters = { routes: [], sidebar: [] };
const listeners = new Set();
let runtimeError = "";
let revision = 0;
const changed = () => {
  revision++;
  for (const listener of listeners) listener();
};
const subscribe = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
const unsupported = (name) => {
  throw new Error(
    `Headlamp API ${name} is outside Lite's headlamp-v1 profile. See docs/headlamp-plugins.md.`,
  );
};
const moduleProxy = (name, values) =>
  new Proxy(values, {
    get(target, key) {
      if (typeof key === "symbol" || key === "__esModule" || key === "then")
        return target[key];
      if (!(key in target)) return unsupported(`${name}.${key}`);
      return target[key];
    },
  });

function request(path, options = {}) {
  if (
    options.cluster &&
    options.cluster !== window.astronomer.context.clusterId
  )
    return Promise.reject(new Error("Plugins cannot select another cluster"));
  const match =
    /^\/(?:api\/(v[^/]+)|apis\/([^/]+)\/(v[^/]+))\/(?:namespaces\/([^/]+)\/)?([^/?]+)(?:\/([^/?]+))?(?:\?(.*))?$/.exec(
      path,
    );
  if (!match)
    return Promise.reject(
      new Error("Only Kubernetes resource API paths are supported"),
    );
  const [, coreVersion, group, version, namespace, resource, name, query] =
    match;
  const params = new URLSearchParams(query || "");
  if ([...params.keys()].some((key) => !["continue", "limit"].includes(key)))
    return Promise.reject(
      new Error(
        "Unsupported resource query; use ResourceClasses hooks for namespace filtering",
      ),
    );
  const method = (options.method || "GET").toUpperCase();
  const verb =
    method === "GET"
      ? name
        ? "get"
        : "list"
      : method === "DELETE"
        ? "delete"
        : method === "POST" || method === "PUT" || method === "PATCH"
          ? "apply"
          : "";
  if (!verb)
    return Promise.reject(new Error("Unsupported Kubernetes request method"));
  let object;
  try {
    object =
      typeof options.body === "string"
        ? JSON.parse(options.body)
        : options.body;
  } catch {
    return Promise.reject(new Error("Resource body must be JSON"));
  }
  if (
    verb === "apply" &&
    (!object?.metadata?.name || !object?.kind || !object?.apiVersion)
  )
    return Promise.reject(
      new Error("Apply requires a complete Kubernetes object"),
    );
  return window.astronomer.request({
    group: group || "",
    version: coreVersion || version,
    namespace: namespace ? decodeURIComponent(namespace) : undefined,
    resource,
    name: name ? decodeURIComponent(name) : object?.metadata?.name,
    verb,
    object,
    continue: params.get("continue") || undefined,
  });
}

function resourceClass(
  kind,
  resource,
  group = "",
  version = "v1",
  namespaced = true,
) {
  class Resource {
    static kind = kind;
    static pluralName = resource;
    static apiEndpoint = { group, version, resource };
    constructor(jsonData) {
      this.jsonData = jsonData;
    }
    get metadata() {
      return this.jsonData.metadata || {};
    }
    get spec() {
      return this.jsonData.spec || {};
    }
    get status() {
      return this.jsonData.status || {};
    }
    getName() {
      return this.metadata.name;
    }
    getNamespace() {
      return this.metadata.namespace || "";
    }
    getUid() {
      return this.metadata.uid;
    }
    getAge() {
      return this.metadata.creationTimestamp || "";
    }
    getDetailsLink() {
      return `/resources/${resource}/${this.getNamespace()}/${this.getName()}`;
    }
    async delete() {
      return window.astronomer.request({
        group,
        version,
        resource,
        namespace: this.getNamespace(),
        name: this.getName(),
        verb: "delete",
      });
    }
    static async get(name, namespace) {
      return new Resource(
        await window.astronomer.request({
          group,
          version,
          resource,
          name,
          namespace,
          verb: "get",
        }),
      );
    }
    static useList(options = {}) {
      if (Object.keys(options).some((key) => key !== "namespace"))
        unsupported("Resource.useList options other than namespace");
      const [items, setItems] = useState(null),
        [error, setError] = useState(null);
      const namespaceKey = JSON.stringify(
        options.namespace
          ? [options.namespace]
          : namespaced
            ? window.astronomer.context.namespaces
            : [],
      );
      useEffect(() => {
        let active = true,
          loading = false;
        const load = async () => {
          if (loading) return;
          loading = true;
          try {
            const namespaces = JSON.parse(namespaceKey);
            if (!namespaces.length) namespaces.push(undefined);
            const result = [];
            for (const namespace of namespaces) {
              let continuation;
              do {
                const page = await window.astronomer.request({
                  group,
                  version,
                  resource,
                  namespace,
                  verb: "list",
                  continue: continuation,
                });
                result.push(
                  ...(page.items || []).map((item) => new Resource(item)),
                );
                continuation = page.metadata?.continue;
                if (result.length > 5000)
                  throw new Error(
                    "Plugin inventory exceeds 5,000 resources; select a namespace",
                  );
              } while (continuation && active);
            }
            if (active) {
              setItems(result);
              setError(null);
            }
          } catch (e) {
            if (active) setError(e);
          } finally {
            loading = false;
          }
        };
        void load();
        const timer = setInterval(load, 10_000);
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [namespaceKey]);
      return [items, error];
    }
    static useGet(name, namespace) {
      const [item, setItem] = useState(null),
        [error, setError] = useState(null);
      useEffect(() => {
        let active = true;
        Resource.get(name, namespace)
          .then((value) => {
            if (active) {
              setItem(value);
              setError(null);
            }
          })
          .catch((e) => {
            if (active) setError(e);
          });
        return () => {
          active = false;
        };
      }, [name, namespace]);
      return [item, error];
    }
  }
  return Resource;
}
const resources = {};
for (const [kind, resource, group, version, namespaced] of [
  ["Pod", "pods"],
  ["Namespace", "namespaces", "", "v1", false],
  ["Node", "nodes", "", "v1", false],
  ["Service", "services"],
  ["ConfigMap", "configmaps"],
  ["Secret", "secrets"],
  ["ServiceAccount", "serviceaccounts"],
  ["PersistentVolumeClaim", "persistentvolumeclaims"],
  ["PersistentVolume", "persistentvolumes", "", "v1", false],
  ["Event", "events"],
  ["Deployment", "deployments", "apps"],
  ["StatefulSet", "statefulsets", "apps"],
  ["DaemonSet", "daemonsets", "apps"],
  ["ReplicaSet", "replicasets", "apps"],
  ["Job", "jobs", "batch"],
  ["CronJob", "cronjobs", "batch"],
  ["Ingress", "ingresses", "networking.k8s.io"],
  ["NetworkPolicy", "networkpolicies", "networking.k8s.io"],
  ["Role", "roles", "rbac.authorization.k8s.io"],
  ["RoleBinding", "rolebindings", "rbac.authorization.k8s.io"],
  ["ClusterRole", "clusterroles", "rbac.authorization.k8s.io", "v1", false],
  [
    "ClusterRoleBinding",
    "clusterrolebindings",
    "rbac.authorization.k8s.io",
    "v1",
    false,
  ],
])
  resources[kind] = resourceClass(kind, resource, group, version, namespaced);

function SectionBox({ title, children, ...props }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, my: 2 }}>
      <Typography variant="h6">{title}</Typography>
      <Box {...props}>{children}</Box>
    </Paper>
  );
}
function NameValueTable({ rows = [] }) {
  return (
    <table style={{ width: "100%" }}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <th style={{ textAlign: "left", padding: 8 }}>{row.name}</th>
            <td style={{ padding: 8 }}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Table({
  columns = [],
  data = [],
  emptyMessage = "No resources found",
}) {
  if (!data) return <Typography role="status">Loading…</Typography>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th style={{ textAlign: "left", padding: 8 }} key={i}>
              {c.header || c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item, index) => (
          <tr key={item.getUid?.() || index}>
            {columns.map((c, i) => {
              const value = c.accessorFn
                ? c.accessorFn(item)
                : c.accessor
                  ? c.accessor(item)
                  : item[c.accessorKey];
              return (
                <td
                  style={{ padding: 8, borderTop: "1px solid #71717a44" }}
                  key={i}
                >
                  {c.Cell ? (
                    <c.Cell
                      row={{ original: item }}
                      cell={{ getValue: () => value }}
                    />
                  ) : (
                    value
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        {!data.length && (
          <tr>
            <td colSpan={columns.length}>{emptyMessage}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
const configurations = new Map();
let saving = Promise.resolve();
function saveConfiguration(id, value) {
  configurations.set(id, value);
  changed();
  saving = saving
    .then(() =>
      window.astronomer.storage.set(Object.fromEntries(configurations)),
    )
    .catch((error) => {
      runtimeError = error.message;
      changed();
    });
  return saving;
}
class ConfigStore {
  constructor(id) {
    this.id = id;
  }
  useConfig() {
    const id = this.id;
    return function usePluginConfig() {
      useSyncExternalStore(subscribe, () => revision);
      return configurations.get(id) || {};
    };
  }
  get() {
    return configurations.get(this.id) || {};
  }
  set(value) {
    return saveConfiguration(this.id, value);
  }
}

const lib = {
  React,
  ReactJSX,
  ReactDOM: { ...ReactDOM, createRoot },
  MuiMaterial,
  ReactRouter,
  K8s: moduleProxy("K8s", { ResourceClasses: resources, ...resources }),
  ApiProxy: moduleProxy("ApiProxy", {
    request,
    requestWithCluster: (cluster, ...args) =>
      cluster === window.astronomer.context.clusterId
        ? request(...args)
        : Promise.reject(new Error("Plugins cannot select another cluster")),
  }),
  CommonComponents: moduleProxy("CommonComponents", {
    SectionBox,
    NameValueTable,
    Table,
    ResourceListView: ({ title, data, columns }) => (
      <SectionBox title={title}>
        <Table data={data} columns={columns} />
      </SectionBox>
    ),
    Loader: () => <Typography role="status">Loading…</Typography>,
  }),
  ConfigStore,
  registerRoute: (route) => {
    if (!route?.path || !route.component)
      throw new Error("Plugin route requires path and component");
    routes.push(route);
    changed();
  },
  registerSidebarEntry: (item) => {
    sidebar.push(item);
    changed();
  },
  registerSidebarItem: (item) => {
    sidebar.push(item);
    changed();
  },
  registerRouteFilter: (filter) => {
    filters.routes.push(filter);
    changed();
  },
  registerSidebarEntryFilter: (filter) => {
    filters.sidebar.push(filter);
    changed();
  },
  registerHomeSidebarEntryFilter: (filter) => {
    filters.sidebar.push(filter);
    changed();
  },
  registerAppBarAction: (component) => {
    actions.push(component);
    changed();
  },
  registerPluginSettings: (id, component) => {
    settings.push({ id, component });
    changed();
  },
  DefaultAppBarAction: { NOTIFICATION: "notifications" },
  useTranslation: () => ({
    t: (text, values = {}) =>
      text.replace(/{{(\w+)}}/g, (_, key) => values[key] ?? key),
    i18n: { language: "en" },
  }),
  getCluster: () => window.astronomer.context.clusterId,
  getClusterName: () => window.astronomer.context.clusterId,
};
window.pluginLib = moduleProxy("pluginLib", lib);
window.plugins = {};
class Boundary extends React.Component {
  state = { error: "" };
  static getDerivedStateFromError(error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <Alert severity="error">{this.state.error}</Alert>
    ) : (
      this.props.children
    );
  }
}
function Runtime() {
  useSyncExternalStore(subscribe, () => revision);
  const filteredRoutes = routes
    .map((route) => filters.routes.reduce((r, f) => r && f(r), route))
    .filter(Boolean);
  const entries = sidebar
    .map((item) => filters.sidebar.reduce((r, f) => r && f(r), item))
    .filter(Boolean);
  return (
    <ThemeProvider
      theme={createTheme({
        palette: {
          mode: window.astronomer.context.theme,
          primary: { main: "#3b82f6" },
        },
        typography: { fontFamily: "Inter, system-ui, sans-serif" },
        shape: { borderRadius: 8 },
      })}
    >
      <CssBaseline />
      <MemoryRouter>
        <Boundary>
          {runtimeError && <Alert severity="error">{runtimeError}</Alert>}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 2 }}>
            {entries.map((item, i) =>
              item.entryType === "subheader" ? (
                <Typography key={i}>{item.label}</Typography>
              ) : (
                <Link key={i} to={item.url || "/"}>
                  {item.label}
                </Link>
              ),
            )}
          </Box>
          {actions.map((Action, i) => (
            <Boundary key={i}>
              <Action />
            </Boundary>
          ))}
          <Switch>
            {filteredRoutes.map((route, i) => (
              <Route
                key={i}
                path={route.path}
                exact={route.exact}
                component={route.component}
              />
            ))}
            {filteredRoutes.length > 0 && (
              <Redirect to={filteredRoutes[0].path} />
            )}
          </Switch>
          {settings.map(({ id, component: Settings }) => (
            <SectionBox key={id} title="Plugin settings">
              <Settings
                data={configurations.get(id) || {}}
                onDataChange={(value) => saveConfiguration(id, value)}
              />
            </SectionBox>
          ))}
          {!actions.length && !filteredRoutes.length && !settings.length && (
            <Typography>No supported plugin panels registered.</Typography>
          )}
        </Boundary>
      </MemoryRouter>
    </ThemeProvider>
  );
}
window.addEventListener("error", (event) => {
  runtimeError = event.message;
  changed();
});
document.addEventListener("DOMContentLoaded", () => {
  const container = document.createElement("div");
  document.body.prepend(container);
  window.astronomer.storage
    .get()
    .then((values) => {
      for (const [id, value] of Object.entries(values))
        configurations.set(id, value);
      createRoot(container).render(<Runtime />);
    })
    .catch((error) => {
      container.setAttribute("role", "alert");
      container.textContent = `Could not load plugin settings: ${error.message}`;
    });
});
