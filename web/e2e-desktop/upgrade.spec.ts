import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("RC.2 profile retains imported clusters, projects and preferences after upgrade", async () => {
  test.skip(
    !process.env.LITE_DESKTOP_PREVIOUS_EXECUTABLE,
    "Requires the published RC.2 Linux binary",
  );
  const profile = await realpath(
    await mkdtemp(join(tmpdir(), "lite-upgrade-")),
  );
  const args = [
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    `--user-data-dir=${profile}`,
  ];
  const env = {
    ...process.env,
    KUBECONFIG: join(profile, "empty-kubeconfig"),
    ASTRONOMER_LITE_PLUGINS_ENABLED: "false",
  };
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let origin = "";
  let clusterId = "";
  try {
    app = await electron.launch({
      executablePath: process.env.LITE_DESKTOP_PREVIOUS_EXECUTABLE!,
      args,
      env,
    });
    const oldPage = await app.firstWindow();
    await expect(
      oldPage.getByRole("heading", { name: "Clusters", exact: true }),
    ).toBeVisible();
    origin = new URL(oldPage.url()).origin;
    clusterId = await oldPage.evaluate(async () => {
      const response = await fetch("/api/clusters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Astronomer-Lite": "1",
        },
        body: JSON.stringify({
          apiVersion: "v1",
          kind: "Config",
          "current-context": "Upgrade fixture",
          clusters: [
            {
              name: "fixture",
              cluster: {
                server: "https://127.0.0.1:1",
                "insecure-skip-tls-verify": true,
              },
            },
          ],
          users: [{ name: "fixture", user: { token: "test-only" } }],
          contexts: [
            {
              name: "Upgrade fixture",
              context: { cluster: "fixture", user: "fixture" },
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Import failed: ${response.status}`);
      const clusters = (await response.json()) as {
        id: string;
        name: string;
      }[];
      const id = clusters.find(
        (cluster) => cluster.name === "Upgrade fixture",
      )!.id;
      const project = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Astronomer-Lite": "1",
        },
        body: JSON.stringify({
          name: "Upgrade project",
          scopes: [{ clusterId: id, namespace: "default" }],
        }),
      });
      if (!project.ok) throw new Error(`Project failed: ${project.status}`);
      localStorage.setItem("astronomer-lite-theme", "light");
      localStorage.setItem("astronomer-lite-density", "compact");
      localStorage.setItem("astronomer-lite-sidebar-collapsed", "true");
      return id;
    });
    await app.close();
    app = undefined;
    app = await electron.launch({
      executablePath:
        process.env.LITE_DESKTOP_EXECUTABLE ||
        resolve("../desktop/dist/linux-unpacked/astronomer-lite"),
      args,
      env,
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Clusters", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Astronomer Lite");
    expect(new URL(page.url()).origin).toBe(origin);
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute(
      "data-density",
      "compact",
    );
    await expect(
      page.getByRole("button", { name: "Expand sidebar", exact: true }),
    ).toBeVisible();
    const state = await page.evaluate(async () => ({
      clusters: await fetch("/api/clusters").then((response) =>
        response.json(),
      ),
      projects: await fetch("/api/projects").then((response) =>
        response.json(),
      ),
    }));
    expect(state.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: clusterId, name: "Upgrade fixture" }),
      ]),
    );
    expect(state.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Upgrade project",
          scopes: [{ clusterId, namespace: "default" }],
        }),
      ]),
    );
  } finally {
    if (app) await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
