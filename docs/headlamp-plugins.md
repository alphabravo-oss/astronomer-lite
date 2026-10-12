# Headlamp compatibility profile: headlamp-v1

Lite can wrap a Headlamp UMD plugin built with `@kinvolk/headlamp-plugin` and run it inside its existing permission-controlled opaque iframe. This is a compatibility profile, not a promise that every Headlamp plugin works. The core app remains React 19/Tailwind 4; the isolated profile bundles React 18.3, MUI 5 and React Router 5 to match the tested upstream ABI. `make compat-build` generates the runtime consumed by the lazy-loaded extension page.

## Package

Build your plugin with its original Headlamp tooling, supply a Lite manifest declaring exact resource permissions, then wrap it:

```sh
node scripts/package-plugin.mjs headlamp path/to/main.js plugin.json output/plugin
```

The wrapper sets `runtime: "headlamp-v1"` and `entry: "index.html"`. Install the output directory using [the normal plugin workflow](plugins.md), or sign and publish it to your operator catalog. Assets must be self-contained and the plugin HTML must fit within 2 MiB. The runtime itself is supplied by Lite, not copied into every package.

## Supported surface

| Upstream surface | Behavior in Lite |
|---|---|
| React, ReactDOM, JSX runtime, MUI, Router | Bundled iframe-local runtime with Emotion internally; memory navigation |
| Route/sidebar/app-bar registrations | Rendered within the plugin page, never injected into the application shell |
| Settings registration, ConfigStore get/set/useConfig | Per-user, per-plugin server persistence, maximum 32 KiB JSON object |
| CommonComponents | SectionBox, NameValueTable, Table, ResourceListView and Loader |
| Kubernetes resource classes | Common core, workload, ingress/network-policy and RBAC classes with get/useGet/useList/delete |
| ApiProxy resource requests | List/get/apply/delete through Lite's broker, current cluster only, declared permissions and actual Kubernetes RBAC |
| Resource list hooks | Poll every 10 seconds; follow pagination up to 5,000 items; namespace filtering |
| Translation | English strings and simple interpolation |

Unknown SDK exports, unsupported query options, subresources and cross-cluster requests fail explicitly. This profile does not supply the full Headlamp watch API, Redux store, editor/chart libraries, cloud integrations, secure-storage API, host-wide row actions or arbitrary backend plugins. An unsupported package needs adaptation or extension of this profile before installation. Mutations still use Lite's dry-run and host confirmation flow.

## Verified upstream example

`examples/plugins/headlamp-pod-counter` contains the **unmodified built pod-counter example** from Headlamp commit `22ea6b22de8b1ece8e28b75e5e54d54b773db688`, built with its upstream lockfile and `@kinvolk/headlamp-plugin` 0.13.1. Its Apache license and source attribution are included. Browser tests verify real cluster pod counts, persisted settings after reload, frame isolation and denial of undeclared secret access. This is evidence for this example and profile, not certification of the Headlamp plugin catalog.
