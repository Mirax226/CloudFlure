# CloudFlure Radar Bot

Telegram bot + scheduler برای ارسال خودکار چارت Cloudflare Radar به کاربران و تارگت‌های تعریف‌شده در ربات.

## Features
- Express health route و webhook
- Reply keyboard فارسی با ایموجی‌ها
- مدیریت مقصدها و بازه ارسال از داخل ربات
- تولید PNG چارت با QuickChart + Radar API
- زمان‌بندی دقیقه‌ای + جلوگیری از هم‌پوشانی
- پشتیبانی از Radar public/token + حالت auto

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
DATABASE_URL=postgresql://...
```

متغیرهای اختیاری:
```
PUBLIC_URL=https://your-service.onrender.com
RADAR_MODE=auto           # public | token | auto
RADAR_API_TOKEN=...
RADAR_PUBLIC_BASE_URL=https://api.cloudflare.com/client/v4/radar
RADAR_TOKEN_BASE_URL=https://api.cloudflare.com/client/v4/radar
RADAR_HTTP_TIMEOUT_MS=45000
RADAR_RETRY_MAX=2
RADAR_RETRY_BASE_DELAY_MS=1500
SCREENSHOT_COOLDOWN_SEC=30
MAX_SENDS_PER_TICK=20
```

توکن Radar API را داخل منوی ربات تنظیم کنید (یا از `RADAR_API_TOKEN`).

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
اگر `PUBLIC_URL` تنظیم باشد، webhook به صورت خودکار در استارت ست می‌شود:
```
${PUBLIC_URL}/telegram
```

اگر `PUBLIC_URL` ست نشود، بات به حالت long polling می‌رود.

## Radar mode
- `public`: فقط endpoint عمومی (بدون توکن)
- `token`: فقط با توکن
- `auto`: اول public، در صورت خطاهای مجاز به token fallback می‌کند (در صورت وجود توکن)

تنظیم از داخل ربات:
- منو → «📡 منبع دیتا»
- یا با `RADAR_MODE` در env

## Radar test command
برای تست سریع:
```
/radar_test
```

## Targets
- مقصدها از داخل رابط ربات تنظیم می‌شوند و برای هر تارگت زمان‌بندی جدا دارند.
- برای افزودن مقصد: روی ➕ بزنید و یک پیام از کانال/گروه فوروارد کنید.
- برای ارسال در کانال، بات باید ادمین باشد.

## Troubleshooting
- **400**: پارامترها اشتباه است. تنظیمات درخواست باید اصلاح شود.
- **401/403**: توکن معتبر نیست یا دسترسی ندارد.
- **429**: نرخ درخواست بالا است؛ چند دقیقه بعد دوباره تلاش کنید.
- **Timeout**: سرور Radar دیر پاسخ داد؛ دوباره تلاش کنید.

## Render checklist (Amir)
1. Render → New → PostgreSQL بسازید.
2. Render → New → Web Service (Docker) و repo را وصل کنید.
3. فقط این env vars را تنظیم کنید (Internal Database URL را استفاده کن):
   ```bash
   BOT_TOKEN=...
   DATABASE_URL=postgresql://...
   PUBLIC_URL=https://your-service.onrender.com
   RADAR_MODE=auto
   RADAR_API_TOKEN=...
   ```
4. Deploy as Docker.
5. Bot را به کانال/گروه اضافه کن و Admin کن.
6. از داخل ربات:
   - یک پیام از کانال/گروه به ربات Forward کن تا مقصد اضافه شود.
   - توکن Radar API را از منو تنظیم کن یا حالت Public را انتخاب کن.
   - بازه ارسال را تنظیم کن و مقصد را فعال نگه دار.

## Health Check
`GET /health` باید JSON برگرداند:
```json
{ "ok": true, "time": "...", "version": "...", "db": "ok" }
```
