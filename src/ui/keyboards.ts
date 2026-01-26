import { Keyboard } from "grammy";

export const labels = {
  status: "📊 وضعیت من",
  setTime: "⏱ تنظیم زمان ارسال",
  activate: "✅ فعال‌سازی ارسال خودکار",
  deactivate: "⛔ غیرفعال‌سازی",
  help: "ℹ️ راهنما",
  adminSendNow: "⚡ ارسال فوری چارت",
};

export const buildMainKeyboard = (isAdminUser: boolean): Keyboard => {
  const keyboard = new Keyboard()
    .text(labels.status)
    .text(labels.setTime)
    .row()
    .text(labels.activate)
    .text(labels.deactivate)
    .row()
    .text(labels.help);

  if (isAdminUser) {
    keyboard.row().text(labels.adminSendNow);
  }

  return keyboard.resized();
};
