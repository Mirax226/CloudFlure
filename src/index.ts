import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createBot, type BotState } from "./bot.js";
import { runSchedulerTick } from "./scheduler/tick.js";

const config = loadConfig();
console.log("Config loaded", {
  publicBaseUrl: config.publicBaseUrl,
  maxSendsPerTick: config.maxSendsPerTick,
});

const app = express();
app.use(express.json());

const botState: BotState = { lastSendByUserId: new Map() };
const { bot, sendChartToChat } = createBot(prisma, config, botState);

app.get("/health", (_req: Request, res: Response) => {
  res.send("ok");
});

const port = Number(process.env.PORT) || 3000;

const start = async () => {
  try {
    await prisma.$connect();
    console.log("DB connected");
  } catch (error) {
    console.error("DB connection failed", { error });
    process.exit(1);
  }

  await bot.init();
  console.log("Bot initialized");

  app.post("/telegram/webhook", async (req: Request, res: Response) => {
    await bot.handleUpdate(req.body);
    res.send("ok");
  });

  const webhookUrl = `${config.publicBaseUrl}/telegram/webhook`;
  await bot.api.setWebhook(webhookUrl);
  console.log(`Webhook set to ${webhookUrl}`);

  const schedulerState = { isTickRunning: false };
  const tick = async () => {
    await runSchedulerTick(prisma, config, { sendChartToChat }, schedulerState);
  };

  setInterval(tick, 60 * 1000);
  console.log("Scheduler started");

  app.listen(port, () => {
    console.log(`server_listening:${port}`);
  });
};

start().catch((error) => {
  console.error("startup_failed", { error });
  process.exit(1);
});
