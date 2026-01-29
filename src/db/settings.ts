import type { PrismaClient } from "@prisma/client";
import type { RadarMode } from "../radar/fetch.js";

const SETTINGS_ID = 1;

export type RadarSettings = {
  radarApiToken: string | null;
  radarMode: RadarMode | null;
};

export const getRadarApiToken = async (prisma: PrismaClient): Promise<string | null> => {
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return settings?.radarApiToken ?? null;
};

export const setRadarApiToken = async (
  prisma: PrismaClient,
  token: string
): Promise<void> => {
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { radarApiToken: token },
    create: { id: SETTINGS_ID, radarApiToken: token },
  });
};

export const getRadarMode = async (prisma: PrismaClient): Promise<RadarMode | null> => {
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return (settings?.radarMode as RadarMode | null) ?? null;
};

export const setRadarMode = async (prisma: PrismaClient, mode: RadarMode): Promise<void> => {
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { radarMode: mode },
    create: { id: SETTINGS_ID, radarMode: mode },
  });
};

export const getRadarSettings = async (prisma: PrismaClient): Promise<RadarSettings> => {
  const settings = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return {
    radarApiToken: settings?.radarApiToken ?? null,
    radarMode: (settings?.radarMode as RadarMode | null) ?? null,
  };
};
