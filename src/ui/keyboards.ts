import { Keyboard } from "grammy";

export const labels = {
  sendNow: "⚡ ارسال فوری چارت",
  addTarget: "➕ افزودن کانال/گروه",
  listTargets: "🗂 لیست مقصدها",
  selectTarget: "🎯 انتخاب مقصد",
  setInterval: "⏱ تنظیم بازه ارسال",
  toggleTarget: "✅ فعال/غیرفعال مقصد",
  setRadarToken: "🗝️ تنظیم توکن Radar API",
  setRadarSource: "📡 منبع دیتا",
  setRadarDateRange: "بازه زمانی چارت 📆",
  help: "🧩 راهنما",
};

export const buildMainKeyboard = (): Keyboard => {
  const keyboard = new Keyboard()
    .text(labels.sendNow)
    .row()
    .text(labels.addTarget)
    .text(labels.listTargets)
    .row()
    .text(labels.selectTarget)
    .text(labels.setInterval)
    .row()
    .text(labels.toggleTarget)
    .row()
    .text(labels.setRadarToken)
    .text(labels.setRadarSource)
    .row()
    .text(labels.setRadarDateRange)
    .row()
    .text(labels.help);

  return keyboard.resized();
};
