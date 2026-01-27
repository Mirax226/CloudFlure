import { chromium } from "playwright";

const RADAR_URL = "https://radar.cloudflare.com/ir?dateRange=1d";

export const captureRadarChart = async (): Promise<Buffer> => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });

  const page = await context.newPage();

  await page.goto(RADAR_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const selectors = [
    "main section:has(canvas)",
    "main [data-testid*='chart']",
    "main [class*='chart']",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        const box = await locator.boundingBox();
        if (box) {
          const buffer = await locator.screenshot({ type: "png" });
          await browser.close();
          return buffer;
        }
      }
    } catch {
      // continue to fallback
    }
  }

  const fallbackLocator = page.locator("main").first();
  try {
    if (await fallbackLocator.count()) {
      const buffer = await fallbackLocator.screenshot({ type: "png" });
      await browser.close();
      return buffer;
    }
  } catch {
    // ignore fallback errors
  }

  const buffer = await page.screenshot({ type: "png", fullPage: true });
  await browser.close();
  return buffer;
};
