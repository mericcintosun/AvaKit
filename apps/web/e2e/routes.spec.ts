import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/*
 * The key routes of the site load cleanly in a real browser: no console
 * error, no uncaught error, no Content Security Policy violation (enforced or
 * report-only), and no request to a host nobody accounted for. Each page is
 * scrolled to the bottom so what loads on scroll (videos, the 3D models on
 * /avatar) loads too.
 *
 * Every route of app/sitemap.ts is here, plus the Turkish pages and /pitch.
 * Add a page to both when it is added to the site.
 */
const ROUTES = [
  "/",
  "/tr",
  "/new",
  "/templates",
  "/tr/templates",
  "/docs",
  "/docs/core",
  "/docs/react",
  "/docs/cli",
  "/docs/mcp",
  "/docs/studio",
  "/docs/telemetry",
  "/stats",
  "/terminal",
  "/avatar",
  "/pitch",
];

for (const route of ROUTES) {
  test(`${route} loads without console errors or CSP violations`, async ({
    page,
    network,
    issues,
  }) => {
    const response = await page.goto(route);
    expect(response?.status(), `HTTP status of ${route}`).toBe(200);
    await page.waitForLoadState("networkidle");
    await scrollToBottom(page);
    await page.waitForLoadState("networkidle");

    expect(network.blocked, "requests to hosts these tests do not serve").toEqual([]);
    expect(issues.cspViolations, "CSP violations").toEqual([]);
    expect(issues.pageErrors, "uncaught errors").toEqual([]);
    expect(issues.consoleErrors, "console errors").toEqual([]);
  });
}

/*
 * A path no page matches gets the 404 page, and it loads as cleanly as the
 * others. The 404 page is the easiest one to leave out of a Content Security
 * Policy: prerendered at build time, its scripts carry no nonce. The only
 * console error allowed is the browser's own line about the 404 response.
 */
const UNKNOWN_ROUTES = ["/no-such-page", "/tr/no-such-page", "/docs/no-such-page"];

for (const route of UNKNOWN_ROUTES) {
  test(`${route} answers 404 without console errors or CSP violations`, async ({
    page,
    network,
    issues,
  }) => {
    const response = await page.goto(route);
    expect(response?.status(), `HTTP status of ${route}`).toBe(404);
    await expect(page.getByRole("heading", { name: /could not be found/i })).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(network.blocked, "requests to hosts these tests do not serve").toEqual([]);
    expect(issues.cspViolations, "CSP violations").toEqual([]);
    expect(issues.pageErrors, "uncaught errors").toEqual([]);
    expect(issues.consoleErrors, "console errors").toEqual([
      `Failed to load resource: the server responded with a status of 404 (Not Found) (at ${page.url()})`,
    ]);
  });
}

/** Scroll down a screen at a time, so content that waits to be scrolled into view loads. */
async function scrollToBottom(page: Page) {
  await page.evaluate(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await pause();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await pause();
  });
}
