import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createBot, type BotState } from "./bot.js";
import { runSchedulerTick } from "./scheduler/tick.js";
import { logError, logInfo } from "./logger.js";

const config = loadConfig();
console.log("Config loaded", {
  publicUrl: config.publicUrl,
  maxSendsPerTick: config.maxSendsPerTick,
});

process.on("uncaughtException", async (error) => {
  await logError("Unhandled error", error);
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  await logError("Unhandled error", reason);
  process.exit(1);
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
    await logError("Database connection failed", { scope: "db_connection", error });
    process.exit(1);
  }

  await bot.init();
  console.log("Bot initialized");

  app.post("/telegram", (req: Request, res: Response) => {
    res.send("ok");
    console.log("telegram_update_received", {
      updateType: Object.keys(req.body ?? {})[0] ?? "unknown",
    });
    void bot.handleUpdate(req.body).catch((error) => {
      void logError("webhook_update_failed", { error });
    });
  });

  const webhookUrl = `${config.publicUrl}/telegram`;
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

  await logInfo("Server started", { port });
};

start().catch(async (error) => {
  await logError("Startup failed", { scope: "startup", error });
  process.exit(1);
});
