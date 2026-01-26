import type { EnvConfig } from "../config.js";
import type { Context } from "grammy";

export const isAdmin = (ctx: Context, config: EnvConfig): boolean => {
  const userId = ctx.from?.id;
  if (!userId) {
    return false;
  }
  return config.adminUserIds.includes(userId);
};
