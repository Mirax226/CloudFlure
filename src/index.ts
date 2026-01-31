import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createBot, type BotState } from "./bot.js";
import { runSchedulerTick } from "./scheduler/tick.js";
import { logError, logInfo, logWarn } from "./logger.js";

const config = loadConfig();
console.log("Config loaded", {
  publicUrl: config.publicUrl,
  maxSendsPerTick: config.maxSendsPerTick,
  radarMode: config.radar.mode,
});
void logInfo("radar_client_ready", {
  publicBaseUrl: config.radar.publicBaseUrl,
  tokenBaseUrl: config.radar.tokenBaseUrl,
});

process.on("uncaughtException", async (error: unknown) => {
  await logError("Unhandled error", error);
  process.exit(1);
});

process.on("unhandledRejection", async (reason: unknown) => {
  await logError("Unhandled error", reason);
  process.exit(1);
});

const app = express();
app.use(express.json());

const botState: BotState = { lastSendByUserId: new Map(), lastRadarSourceByUserId: new Map() };
const { bot, sendChartToChat } = createBot(prisma, config, botState);

const version = process.env.npm_package_version ?? "unknown";

app.get("/health", async (_req: Request, res: Response) => {
  const time = new Date().toISOString();
  let dbStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    dbStatus = "error";
    await logError("health_db_check_failed", { error });
  }
  res.json({ ok: dbStatus === "ok", time, version, db: dbStatus });
});

const port = Number(process.env.PORT) || 10000;

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

  if (config.publicUrl) {
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
  } else {
    await logWarn("PUBLIC_URL missing, falling back to long polling");
    void bot.start();
  }

  const schedulerState = { isTickRunning: false };
  const tick = async () => {
    await runSchedulerTick(prisma, config, { sendChartToChat }, schedulerState);
  };

  setInterval(tick, 60 * 1000);
  await logInfo("scheduler_started", { intervalSec: 60 });

  app.listen(port, () => {
    console.log(`server_listening:${port}`);
  });

  await logInfo("Server started", { port });
};

start().catch(async (error) => {
  await logError("Startup failed", { scope: "startup", error });
  process.exit(1);
});
