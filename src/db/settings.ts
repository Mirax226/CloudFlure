import type { PrismaClient } from "@prisma/client";

const SETTINGS_ID = 1;

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
