import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createBot, type BotState } from "./bot.js";
import { captureRadarChart } from "./screenshot/capture.js";
import { runSchedulerTick } from "./scheduler/tick.js";

const config = loadConfig();
console.log("config_loaded", {
  publicBaseUrl: config.publicBaseUrl,
  adminCount: config.adminUserIds.length,
});

const app = express();
app.use(express.json());

const botState: BotState = { lastAdminSendAt: null };
const { bot, sendChartToChat } = createBot(prisma, config, botState);

app.get("/health", (_req: Request, res: Response) => {
  res.send("ok");
});

app.post("/telegram/webhook", async (req: Request, res: Response) => {
  await bot.handleUpdate(req.body);
  res.send("ok");
});

const port = Number(process.env.PORT) || 3000;

const start = async () => {
  await bot.api.setWebhook(`${config.publicBaseUrl}/telegram/webhook`);

  const schedulerState = { inMemoryLock: false };
  const tick = async () => {
    await runSchedulerTick(prisma, config, { sendChartToChat }, schedulerState);
  };

  setInterval(tick, 60 * 1000);

  if (config.sendOnDeploy) {
    const buffer = await captureRadarChart();
    const caption = `Cloudflare Radar 🇮🇷`;
    const targets = await prisma.target.findMany({ where: { isEnabled: true } });
    if (!targets.length) {
      console.log("send_on_deploy_skipped", { reason: "no_targets" });
    }
    for (const target of targets) {
      await sendChartToChat(target.tgChatId, caption, buffer);
    }
  }

  app.listen(port, () => {
    console.log(`server_listening:${port}`);
  });
};

start().catch((error) => {
  console.error("startup_failed", { error });
  process.exit(1);
});
