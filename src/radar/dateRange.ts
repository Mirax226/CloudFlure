export type RadarDateRangePreset = "D1" | "D2" | "D3" | "D7" | "D14" | "D21" | "M1" | "M2" | "M3" | "Y1";

export type RadarApiDateRangeParams = {
  dateRange?: string;
  since?: string;
  until?: string;
};

const DAY_RANGE_MAP: Record<RadarDateRangePreset, string | null> = {
  D1: "1d",
  D2: "2d",
  D3: "3d",
  D7: "7d",
  D14: "14d",
  D21: "21d",
  M1: null,
  M2: null,
  M3: null,
  Y1: null,
};

const FALLBACK_DAY_RANGE_MAP: Record<RadarDateRangePreset, string | null> = {
  D1: "1d",
  D2: "2d",
  D3: "3d",
  D7: "7d",
  D14: "14d",
  D21: "21d",
  M1: "30d",
  M2: "60d",
  M3: "90d",
  Y1: "365d",
};

const shiftDate = (base: Date, preset: RadarDateRangePreset): Date => {
  const next = new Date(base.getTime());
  if (preset === "Y1") {
    next.setFullYear(next.getFullYear() - 1);
    return next;
  }
  const monthDelta = preset === "M1" ? 1 : preset === "M2" ? 2 : preset === "M3" ? 3 : 0;
  if (monthDelta > 0) {
    next.setMonth(next.getMonth() - monthDelta);
  }
  return next;
};

export const rangePresetToApiParams = (
  preset: RadarDateRangePreset,
  now: Date = new Date()
): { primary: RadarApiDateRangeParams; fallback?: RadarApiDateRangeParams } => {
  const dayRange = DAY_RANGE_MAP[preset];
  if (dayRange) {
    return { primary: { dateRange: dayRange } };
  }

  const since = shiftDate(now, preset);
  return {
    primary: {
      since: since.toISOString(),
      until: now.toISOString(),
    },
    fallback: {
      dateRange: FALLBACK_DAY_RANGE_MAP[preset] ?? "30d",
    },
  };
};

export const isDayRangePreset = (preset: RadarDateRangePreset): boolean => DAY_RANGE_MAP[preset] !== null;
