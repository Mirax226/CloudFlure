import { chromium } from "playwright";

const RADAR_URL = "https://radar.cloudflare.com/ir?dateRange=1d";

export const captureRadarChart = async (): Promise<Buffer> => {
  const browser = await chromium.launch({ headless: true });
  const retryDelaysMs = [0, 2000, 5000];
  let lastError: unknown;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) {
      await delay(retryDelaysMs[attempt]);
    }

    const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(90_000);
    page.setDefaultTimeout(90_000);

    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();
      if (["font", "media"].includes(type) || url.includes("analytics") || url.includes("beacon")) {
        return route.abort();
      }
      return route.continue();
    });

    try {
      await page.goto(RADAR_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const selectors = [
        "main section:has(canvas)",
        "main [data-testid*='chart']",
        "main [class*='chart']",
      ];

      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: "visible", timeout: 15_000 });
          const buffer = await locator.screenshot({ type: "png" });
          await page.close();
          await context.close();
          await browser.close();
          return buffer;
        } catch {
          // continue to fallback
        }
      }

      const fallbackLocator = page.locator("main").first();
      try {
        await fallbackLocator.waitFor({ state: "visible", timeout: 10_000 });
        const buffer = await fallbackLocator.screenshot({ type: "png" });
        await page.close();
        await context.close();
        await browser.close();
        return buffer;
      } catch {
        // ignore fallback errors
      }

      const buffer = await page.screenshot({ type: "png", fullPage: true });
      await page.close();
      await context.close();
      await browser.close();
      return buffer;
    } catch (error) {
      lastError = error;
      console.warn("radar_capture_retry", {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : error,
      });
      await page.close();
      await context.close();
    }
  }

  await browser.close();
  throw new Error(
    `Radar capture failed after ${retryDelaysMs.length} attempts: ${
      lastError instanceof Error ? lastError.message : "Unknown error"
    }`
  );
};
