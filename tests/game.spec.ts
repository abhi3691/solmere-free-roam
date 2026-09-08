import { expect, test } from "@playwright/test";

test("loads, drives, resets, changes vehicles, travels and shoots", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const start = page.getByRole("button", { name: "Let's drive" });
  await expect(start).toBeEnabled({ timeout: 45000 });
  await expect(page.getByRole("button", { name: "Open world map" })).toBeHidden();
  await start.click({ trial: true });
  await page.screenshot({ path: testInfo.outputPath("welcome.png") });
  await start.click();
  await expect(page.getByText("The road is yours.")).toBeVisible();
  if (testInfo.project.name === "mobile") {
    const pedal = page.getByRole("button", { name: "Accelerate or walk forward" });
    await expect(pedal).toBeVisible();
    const bounds = (await pedal.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect.poll(async () => Number(await page.getByTestId("speed").textContent())).toBeGreaterThan(0);
    await page.mouse.up();
  } else {
    await page.keyboard.down("w");
    await expect.poll(async () => Number(await page.getByTestId("speed").textContent())).toBeGreaterThan(0);
    await page.keyboard.up("w");
  }
  await page.getByRole("button", { name: "Reset ride", exact: true }).click();
  await expect(page.getByTestId("speed")).toHaveText("000");
  await page.getByRole("button", { name: "Garage", exact: true }).click();
  await page.getByRole("button", { name: /Highland 110/ }).click();
  await expect(page.locator(".vehicle-card.selected")).toContainText("Highland 110");
  await page.getByRole("button", { name: "Take it for a drive" }).click();
  await expect(page.locator(".current-vehicle")).toContainText("Highland 110");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".district-list button")).toHaveCount(14);
  await page.getByRole("button", { name: /Mistvale Highland escape/ }).click();
  await expect(page.locator(".location-tag h2")).toHaveText("Mistvale");
  await page.getByRole("button", { name: "Loadout", exact: true }).click();
  await page.getByRole("button", { name: /Carbine/ }).click();
  await page.getByRole("button", { name: "Head out on foot" }).click();
  await expect(page.getByRole("button", { name: "Return to car" })).toBeVisible();
  await expect(page.locator(".drive-details")).toContainText("30 / 30");
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "FIRE", exact: true }).click();
  else await page.keyboard.press("f");
  await expect(page.locator(".drive-details")).not.toContainText("30 / 30");
  await page.getByRole("button", { name: "Reload weapon" }).click();
  await expect(page.locator(".drive-details")).toContainText("30 / 30", { timeout: 10000 });
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("dialog")).toContainText("simulation is paused");
  await page.keyboard.press("f");
  await expect(page.locator(".drive-details")).toContainText("30 / 30");
  await page.screenshot({ path: testInfo.outputPath("pause.png") });
  await page.getByRole("button", { name: "Back to the road" }).click();
  await page.getByRole("button", { name: "Loadout", exact: true }).click();
  await expect(page.locator(".weapon-card")).toHaveCount(6);
  await page.getByRole("button", { name: /Marksman/ }).click();
  await page.getByRole("button", { name: "Head out on foot" }).click();
  await expect(page.locator(".drive-details")).toContainText("MARKSMAN");
  await expect(page.locator(".drive-details")).toContainText("8 / 8");
  await page.getByRole("button", { name: "Petrol", exact: true }).click();
  await page.getByRole("button", { name: /Kessel Petrol/ }).click();
  const initialFuel = parseFloat((await page.getByTestId("fuel").textContent())!);
  const initialCredits = parseFloat((await page.getByTestId("credits").textContent())!);
  await page.getByRole("button", { name: /Refuel up to 10 L/ }).click();
  await expect.poll(async () => parseFloat((await page.getByTestId("fuel").textContent())!)).toBeCloseTo(initialFuel + 10, 0);
  await expect.poll(async () => parseFloat((await page.getByTestId("credits").textContent())!)).toBeCloseTo(initialCredits - 20, 0);
  await expect(page.getByTestId("health")).toHaveText("100");
  await page.screenshot({ path: testInfo.outputPath("gameplay.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("explains when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).includes("webgl")) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(page.locator(".error-message")).toContainText("Your browser needs WebGL to play");
  await expect(page.getByRole("button", { name: "3D renderer unavailable" })).toBeDisabled();
});

test("start action remains reachable on short screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/");
  const start = page.getByRole("button", { name: "Let's drive" });
  await expect(start).toBeEnabled({ timeout: 45000 });
  await start.click();
  await expect(page.getByTestId("health")).toHaveText("100");
});
