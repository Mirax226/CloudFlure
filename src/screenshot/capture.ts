import { chromium, type Route } from "playwright";

const RADAR_URL = "https://radar.cloudflare.com/ir?dateRange=1d";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const captureRadarChart = async (): Promise<Buffer> => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });

  const page = await context.newPage();
  await page.route("**/*", (route: Route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "font" || resourceType === "image") {
      return route.abort();
    }
    return route.continue();
  });

  await page.goto(RADAR_URL, { waitUntil: "networkidle" });
  await delay(1500);

  const selectors = [
    "main", 
    "section", 
    "#app",
    "body",
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

  const buffer = await page.screenshot({ type: "png", fullPage: true });
  await browser.close();
  return buffer;
};
