import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

for (const width of [900, 1440]) {
  test(`packaged desktop loads the branded workspace and closes its private server (${width}px)`, async ({
    request,
  }, testInfo) => {
    const profile = await realpath(
      await mkdtemp(join(tmpdir(), "lite-desktop-ui-")),
    );
    const paths = {
      linux: "linux-unpacked/astronomer-lite",
      win32: "win-unpacked/Astronomer Lite.exe",
      darwin: `${process.arch === "arm64" ? "mac-arm64" : "mac"}/Astronomer Lite.app/Contents/MacOS/Astronomer Lite`,
    };
    const defaultPath = paths[process.platform as keyof typeof paths];
    if (!defaultPath)
      throw new Error(`Unsupported desktop test platform: ${process.platform}`);
    const executablePath =
      process.env.LITE_DESKTOP_EXECUTABLE ||
      resolve("../desktop/dist", defaultPath);
    // Linux can isolate the default app-data path without touching the real profile.
    const useDefaultProfile = process.platform === "linux" && width === 900;
    const expectedProfile = useDefaultProfile
      ? join(profile, "Astronomer-Lite")
      : profile;
    const args = [
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ...(useDefaultProfile ? [] : [`--user-data-dir=${profile}`]),
    ];
    if (process.env.LITE_DESKTOP_OZONE_PLATFORM === "wayland")
      args.push("--ozone-platform=wayland");
    const env = {
      ...process.env,
      ASTRONOMER_LITE_PLUGINS_ENABLED: "false",
      XDG_CONFIG_HOME: profile,
      APPDATA: profile,
      KUBECONFIG: join(profile, "empty-kubeconfig"),
    };
    const app = await electron.launch({
      executablePath,
      args,
      env,
      timeout: 30_000,
    });
    let origin = "";
    let failure: unknown;
    try {
      expect(
        await realpath(
          await app.evaluate(({ app }) => app.getPath("userData")),
        ),
      ).toBe(expectedProfile);
      const page = await app.firstWindow();
      await expect(page).toHaveTitle("Astronomer Lite");
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getTitle(),
        ),
      ).toBe("Astronomer Lite");
      await page.setViewportSize({ width, height: 800 });
      await expect(
        page.getByRole("heading", { name: "Clusters", exact: true }),
      ).toBeVisible();
      const openNavigation = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      if (await openNavigation.isVisible()) {
        await openNavigation.click();
        const navigation = page.getByRole("dialog", {
          name: "Navigation",
          exact: true,
        });
        await expect(
          navigation.getByRole("link", {
            name: "Astronomer Lite home",
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(navigation).toBeHidden();
      } else {
        await expect(
          page.getByText("Astronomer Lite", { exact: true }).first(),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Collapse sidebar", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Expand sidebar", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("desktop-collapsed.png"),
          animations: "disabled",
        });
        await page
          .getByRole("button", { name: "Expand sidebar", exact: true })
          .click();
      }
      expect(
        await page.evaluate(
          () => typeof (globalThis as Record<string, unknown>).require,
        ),
      ).toBe("undefined");
      origin = new URL(page.url()).origin;
      expect(new URL(origin).hostname).toBe("127.0.0.1");
      expect((await request.get(`${origin}/api/clusters`)).status()).toBe(401);
      await page.screenshot({
        path: testInfo.outputPath("desktop-workspace.png"),
        fullPage: true,
        animations: "disabled",
      });
      expect(await app.evaluate(({ app }) => app.getName())).toBe(
        "Astronomer Lite",
      );
      const documentId = await page.evaluate(() => {
        const marker = crypto.randomUUID();
        document.documentElement.dataset.navigationMarker = marker;
        return marker;
      });
      await app.evaluate(({ Menu }) => {
        const settings = Menu.getApplicationMenu()?.getMenuItemById("settings");
        if (!settings || settings.accelerator !== "CommandOrControl+,")
          throw new Error("Native Settings menu missing");
        settings.click();
      });
      await expect(page).toHaveURL(`${origin}/settings`);
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.navigationMarker,
        ),
      ).toBe(documentId);
      expect(
        await page.evaluate(() => Object.keys(window.astronomerDesktop ?? {})),
      ).toEqual(["onOpenSettings"]);
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Plugins", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          async () => (await fetch("/api/extensions")).status,
        ),
      ).toBe(404);
      // The second invocation must focus the first app instead of starting another server.
      await expect(
        electron.launch({ executablePath, args, env, timeout: 10_000 }),
      ).rejects.toThrow();
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
    } catch (error) {
      failure = error;
      console.error(error);
    } finally {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Desktop did not exit within 20 seconds")),
              20_000,
            );
          }),
        ]);
      } catch (error) {
        app.process().kill("SIGKILL");
        failure ??= error;
      } finally {
        clearTimeout(timer);
        await rm(profile, { recursive: true, force: true });
      }
    }
    if (failure) throw failure;
    await expect
      .poll(async () => {
        try {
          await fetch(`${origin}/api/healthz`, {
            signal: AbortSignal.timeout(1000),
          });
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  });
}
