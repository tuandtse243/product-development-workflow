import { expect, test } from "@playwright/test";

test("home shows the empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nothing to do.")).toBeVisible();
});
