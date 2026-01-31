import type { PrismaClient } from "@prisma/client";
import type { RadarMode } from "../radar/fetch.js";

export type RadarSettings = {
  radarApiToken: string | null;
  radarMode: RadarMode | null;
};

const SETTINGS_ID = 1;

export const getRadarApiToken = async (prisma: PrismaClient, userId?: number): Promise<string | null> => {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user?.radarApiToken ?? null;
  }
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.radarApiToken ?? null;
};

export const setRadarApiToken = async (
  prisma: PrismaClient,
  token: string | null,
  userId?: number
): Promise<void> => {
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { radarApiToken: token },
    });
    return;
  }
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { radarApiToken: token },
    create: { id: SETTINGS_ID, radarApiToken: token },
  });
};

export const getRadarMode = async (prisma: PrismaClient, userId?: number): Promise<RadarMode | null> => {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return (user?.radarMode as RadarMode | null) ?? null;
  }
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return (settings?.radarMode as RadarMode | null) ?? null;
};

export const setRadarMode = async (prisma: PrismaClient, mode: RadarMode, userId?: number): Promise<void> => {
  if (userId) {
    await prisma.user.update({ where: { id: userId }, data: { radarMode: mode } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { radarMode: mode },
    create: { id: SETTINGS_ID, radarMode: mode },
  });
};

export const getRadarSettings = async (prisma: PrismaClient, userId?: number): Promise<RadarSettings> => {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return {
      radarApiToken: user?.radarApiToken ?? null,
      radarMode: (user?.radarMode as RadarMode | null) ?? null,
    };
  }
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return {
    radarApiToken: settings?.radarApiToken ?? null,
    radarMode: (settings?.radarMode as RadarMode | null) ?? null,
  };
};
