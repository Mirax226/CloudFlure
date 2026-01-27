# CloudFlure Radar Bot

Telegram bot + scheduler برای ارسال خودکار چارت Cloudflare Radar به کاربران و یک کانال.

## Features
- Express health route و webhook
- Reply keyboard فارسی با ایموجی‌ها
- تنظیم زمان ارسال از داخل ربات
- اسکرین‌شات با Playwright
- زمان‌بندی دقیقه‌ای + قفل جلوگیری از ارسال تکراری

## Requirements
- Node.js 20+
- PostgreSQL (Render)

## Setup
### 1) ساخت ربات
- در BotFather یک ربات بسازید و `BOT_TOKEN` را بگیرید.

### 2) دیتابیس Render
- یک PostgreSQL در Render بسازید.
- `DATABASE_URL` را از Render بگیرید.

### 3) تنظیم متغیرها
```bash
BOT_TOKEN=...
PUBLIC_BASE_URL=https://your-service.onrender.com
DATABASE_URL=postgresql://...
CHANNEL_CHAT_ID=-1001234567890
ADMIN_USER_IDS=12345678,87654321
DEFAULT_TIMEZONE=Asia/Baku
SEND_ON_DEPLOY=false
SCREENSHOT_COOLDOWN_SEC=30
```

### 4) مهاجرت Prisma
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5) اجرای لوکال
```bash
npm run dev
```

## Webhook
Webhook به صورت خودکار در استارت ست می‌شود:
```
${PUBLIC_BASE_URL}/telegram/webhook
```

## Channel Chat ID
- کانال را به صورت Admin اضافه کنید.
- از طریق یک بات دیگر یا ابزارهای تلگرام، `CHAT_ID` را پیدا کنید.
- مقدار باید به شکل `-100...` باشد.

## Admins
- `ADMIN_USER_IDS` لیست عددی ID کاربر است، جدا شده با کاما.

## Deploy on Render
1. Repo را به Render وصل کنید.
2. Dockerfile را انتخاب کنید.
3. Env vars بالا را وارد کنید.
4. Migration ها را در Render اجرا کنید (از داشبورد یا یک Job):
   ```bash
   npm run prisma:migrate
   ```

## Health Check
`GET /health` باید `ok` برگرداند.
