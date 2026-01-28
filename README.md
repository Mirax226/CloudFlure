# CloudFlure Radar Bot

Telegram bot + scheduler برای ارسال خودکار چارت Cloudflare Radar به کاربران و تارگت‌های تعریف‌شده در ربات.

## Features
- Express health route و webhook
- Reply keyboard فارسی با ایموجی‌ها
- مدیریت مقصدها و بازه ارسال از داخل ربات
- اسکرین‌شات با Playwright (عنصر چارت با fallback)
- زمان‌بندی دقیقه‌ای + جلوگیری از هم‌پوشانی

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
متغیرهای الزامی:
```
BOT_TOKEN=...
PUBLIC_BASE_URL=https://your-service.onrender.com
DATABASE_URL=postgresql://...
```

متغیرهای اختیاری:
```bash
DEFAULT_TIMEZONE=Asia/Baku
SCREENSHOT_COOLDOWN_SEC=30
MAX_SENDS_PER_TICK=20
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

## Targets
- مقصدها از داخل رابط ربات تنظیم می‌شوند و برای هر تارگت زمان‌بندی جدا دارند.
- برای افزودن مقصد: روی ➕ بزنید و یک پیام از کانال/گروه فوروارد کنید.
- برای ارسال در کانال، بات باید ادمین باشد.

## Render checklist (Amir)
1. Render → New → PostgreSQL بسازید.
2. Render → New → Web Service (Docker) و repo را وصل کنید.
3. فقط این env vars را تنظیم کنید (Internal Database URL را استفاده کن):
   ```bash
   BOT_TOKEN=...
   PUBLIC_BASE_URL=https://your-service.onrender.com
   DATABASE_URL=postgresql://...
   ```
4. Deploy as Docker.
5. Bot را به کانال/گروه اضافه کن و Admin کن.
6. از داخل ربات:
   - یک پیام از کانال/گروه به ربات Forward کن تا مقصد اضافه شود.
   - بازه ارسال را تنظیم کن و مقصد را فعال نگه دار.

## Health Check
`GET /health` باید `ok` برگرداند.
