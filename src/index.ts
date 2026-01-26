import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createBot, type BotState } from "./bot.js";
import { captureRadarChart } from "./screenshot/capture.js";
import { runSchedulerTick } from "./scheduler/tick.js";

const config = loadConfig();
console.log("config_loaded", {
  publicBaseUrl: config.publicBaseUrl,
  channelChatId: config.channelChatId,
  adminCount: config.adminUserIds.length,
});

const app = express();
app.use(express.json());

const botState: BotState = { lastAdminSendAt: null };
const { bot, sendChartToTargets, sendChartToChannel } = createBot(prisma, config, botState);

app.get("/health", (_req: Request, res: Response) => {
  res.send("ok");
});

app.post("/telegram/webhook/:secret", async (req: Request, res: Response) => {
  if (req.params.secret !== config.webhookSecret) {
    res.status(403).send("forbidden");
    return;
  }
  await bot.handleUpdate(req.body);
  res.send("ok");
});

const port = Number(process.env.PORT) || 3000;

const start = async () => {
  await bot.api.setWebhook(`${config.publicBaseUrl}/telegram/webhook/${config.webhookSecret}`);

  const schedulerState = { inMemoryLock: false };
  const tick = async () => {
    await runSchedulerTick(prisma, config, { sendChartToTargets }, schedulerState);
  };

  setInterval(tick, 60 * 1000);

  if (config.sendOnDeploy) {
    const buffer = await captureRadarChart();
    const caption = `Cloudflare Radar 🇮🇷`;
    await sendChartToChannel(caption, buffer);
  }

  app.listen(port, () => {
    console.log(`server_listening:${port}`);
  });
};

start().catch((error) => {
  console.error("startup_failed", { error });
  process.exit(1);
});
