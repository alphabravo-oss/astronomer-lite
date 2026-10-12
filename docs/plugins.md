# Plugins

**Deferred from the default 0.2.0 experience.** External plugins are disabled unless `ASTRONOMER_LITE_PLUGINS_ENABLED=true`. With the default setting, no catalog is loaded, extension API requests return 404, and plugin routes, navigation and settings are hidden. Existing packages and saved settings are preserved.

Astronomer Lite retains an opt-in runtime for operator-installed external pages. External packages use the Lite SDK or the documented [Headlamp compatibility profile](headlamp-plugins.md).

## Install and enable

Set `ASTRONOMER_LITE_PLUGINS_ENABLED=true` and `ASTRONOMER_LITE_PLUGINS_DIR` to a directory containing one subdirectory per plugin. Each package has `plugin.json` and a self-contained `index.html`. Restart after installing or changing a bundle. In Settings, an administrator reviews the declared permissions and enables it; new plugins are disabled by default. Single-user mode lets the local operator manage plugins.

The server Compose file mounts `./examples/plugins` read-only. It includes the upstream **Headlamp pod-counter** compatibility example, **Namespace summary** (list namespaces) and **Cluster notes** (get/apply/delete ConfigMaps with confirmation). The latter writes `astronomer-lite-note` into a namespace chosen by the user. Its manifest permits all ConfigMaps the user can access, not just that example name: review code and permissions before enabling any plugin.

```json
{
  "id": "namespace-summary",
  "name": "Namespace summary",
  "version": "1.0.0",
  "description": "List namespaces using the current user's credentials.",
  "entry": "index.html",
  "permissions": [{ "group": "", "resource": "namespaces", "verbs": ["list"] }]
}
```

At most 64 packages, 32 permissions per package, and 2 MiB per HTML bundle are accepted. IDs must be lowercase letters/numbers/dots/hyphens, starting with a letter or number. Resource permissions use exact group/resource/verb matches; no wildcard or subresource access. Files are opened through an OS directory root to reject symlink escapes. Enabled state is persisted in the app config directory.

## Browser SDK

Inline scripts can use `window.astronomer`:

```js
const { clusterId, namespaces, theme } = astronomer.context;
const result = await astronomer.request({
  group: "", version: "v1", resource: "namespaces", verb: "list"
});
for (const namespace of result.items) {
  // Render names with textContent, not HTML interpolation.
}
```

Requests support `list`, `get`, `apply`, and `delete`. Include `namespace` for namespaced operations, and `name` for all operations except list. List responses contain at most 500 items; pass `metadata.continue` as `continue` for the next page. Apply requires an `object` whose API version, kind, namespace, and name match the requested resource. The host supplies the current cluster ID; a plugin cannot choose another cluster through this bridge.

The host executes a server-side dry-run for apply/delete and shows its own confirmation dialog. Cancel rejects the promise. Confirm performs the action, returning the API result. Eight requests may be in flight, with one pending mutation per frame. Context/theme changes reload the frame and clear pending confirmation. Requests time out after two minutes.

## Access boundaries and trust

Code runs in an opaque-origin iframe with `sandbox="allow-scripts"`. It cannot read host cookies, storage, or DOM. The host validates message source and brokers requests. The backend checks enablement, declared permissions, the current user's workspace, and Kubernetes access before executing. No credentials are passed into the frame. Browser CSP restricts scripts/styles to inline content and blocks fetch, nested frames, and forms. Packages must embed their assets; there is no remote dependency loader.

These browser restrictions are defense in depth, **not a guarantee that malicious plugin code cannot exfiltrate data**, including through navigation of its own frame. Only install reviewed, trusted packages. Plugins can see any data their declared permissions and the user's cluster credentials permit. Disabling a plugin blocks subsequent API/bundle requests; an already open frame may still display data previously received.

The REST broker is also an authenticated API for the user. Host confirmation is a browser interaction safeguard, not a server-enforced approval token for direct API callers. App administrators enable packages globally but do not grant Kubernetes permissions.

Not implemented: unattended automatic updates, remote assets, host-wide injected row actions, or backend executable plugins. Headlamp compatibility is limited to the documented profile.

## Internal registry

Bundled pages use `NavigationItem` and `ResourcePage` in `web/src/navigation/registry.tsx`. Routes, sidebar and command palette share that registry independently of the optional plugin runtime. The unused action seam and duplicate backend navigation registry have been removed; external packages use `/api/extensions` only when opted in.

## Persistent settings

`await astronomer.storage.get()` returns this user's settings for this plugin; `await astronomer.storage.set(object)` replaces them. The host fixes the plugin identity, requires enablement and accepts at most 32 KiB of JSON. Settings live in the private user workspace, never another user's browser storage. Do not use settings as a credential vault.

## Signed catalog and updates

Configure `ASTRONOMER_LITE_PLUGIN_CATALOG_URL` with an HTTPS signed-catalog URL and `ASTRONOMER_LITE_PLUGIN_TRUST_KEY_FILE` with a base64 Ed25519 public key file. The plugin directory must exist and be writable by the app. The example Compose mount is read-only; replace it with a writable managed directory to install from a catalog. Plain HTTP is accepted only for loopback test catalogs.

Administrators use Settings → plugin catalog to fetch entries, review permissions, install or update. Both index and package signatures, the catalog's SHA-256 package digest and matching manifests are checked. New packages start disabled. Updates must have a strictly newer semantic version and disable the plugin before replacing its bundle; review and enable again, especially if permissions changed. Downloads do not follow redirects. The installed `bundle.json` and enablement state are written atomically. There is no background auto-update or UI uninstall; an operator can remove a package and restart.

Publish offline (keep the private key outside the deployment):

```sh
node scripts/package-plugin.mjs keygen /private/publisher
node scripts/package-plugin.mjs package examples/plugins/namespace-summary /private/publisher/publisher.pem namespace-summary.json
node scripts/package-plugin.mjs catalog https://plugins.example.com/ /private/publisher/publisher.pem catalog.json namespace-summary.json
```

Host the signed package and catalog files at those URLs, and deploy only `publisher.pub` to Lite. Catalog limits are 128 entries and 8 MiB per response; installed package and HTML limits still apply. Signing identifies the approved publisher; it does not make plugin code trustworthy without review.

For Compose, `docker-compose.plugins.yml` supplies the writable directory and public-key mount:

```sh
docker compose -f docker-compose.server.yml -f docker-compose.plugins.yml up -d
```

Set the catalog URL, trust-key host path and `ASTRONOMER_LITE_PLUGIN_PATH` first. Grant the container's unprivileged user write access to that managed plugin directory. Compose merges the volume by its container target, replacing the read-only example mount.
