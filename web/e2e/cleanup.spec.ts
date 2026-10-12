import { expect, test } from "@playwright/test";

test("resource creation dialog traps focus and invalidates dry-run after edits", async ({ page, request }, testInfo) => {
  const clusters = await request.get("/api/clusters").then((response) => response.json()) as { id: string; reachable: boolean }[];
  const cluster = clusters.find((candidate) => candidate.reachable);
  expect(cluster).toBeTruthy();
  const name = `lite-cleanup-${Date.now()}`;
  const resource = `/api/clusters/${cluster!.id}/resources/configmaps/default/${name}`;
  const yaml = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\n  namespace: default\ndata:\n  value: first\n`;
  try {
    await page.goto(`/clusters/${cluster!.id}/configmaps`);
    await page.getByRole("button", { name: "Create YAML", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create YAML" });
    await expect(dialog).toBeVisible();
    const editor = dialog.locator("textarea");
    await expect(editor).toBeFocused();
    await editor.fill(yaml);
    const apply = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(apply).toBeDisabled();
    await dialog.getByRole("button", { name: "Dry run", exact: true }).click();
    await expect(apply).toBeEnabled();
    expect((await request.get(resource)).status()).toBe(404);
    await editor.fill(yaml.replace("first", "second"));
    await expect(apply).toBeDisabled();
    await dialog.getByRole("button", { name: "Dry run", exact: true }).click();
    await expect(apply).toBeEnabled();
    await apply.focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("create-yaml-dialog.png"), fullPage: true });
    await apply.click();
    await expect(dialog).toHaveCount(0);
    expect(await request.get(resource).then((response) => response.json()).then((object) => object.data.value)).toBe("second");
    await page.getByRole("textbox", { name: "Filter configmaps" }).fill(name);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Filter configmaps" })).toHaveValue("");
  } finally {
    await request.delete(resource);
  }
});
