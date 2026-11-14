import { test as base, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

// No default port: aidw passes the project's test browser as E2E_CDP_URL (`aidw browser start`).
const cdpUrl = process.env.E2E_CDP_URL;

export const test = base.extend<{ context: BrowserContext; page: Page }, { cdpBrowser: Browser }>({
  cdpBrowser: [
    async ({}, use) => {
      if (!cdpUrl) throw new Error("E2E_CDP_URL is not set. Run `aidw browser start`, then `export E2E_CDP_URL=$(aidw browser url)`.");
      const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 }).catch(() => {
        throw new Error(`Cannot reach Chrome at ${cdpUrl}. Run \`aidw browser start\`.`);
      });
      await use(browser);
      await browser.close(); // disconnects; the browser keeps running
    },
    { scope: "worker" },
  ],
  context: async ({ cdpBrowser, baseURL }, use) => {
    const context = await cdpBrowser.newContext({ baseURL });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(await context.newPage()),
});
export { expect } from "@playwright/test";
