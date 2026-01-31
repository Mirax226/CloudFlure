export type RadarEndpointName = "trafficCountries";

export type RadarEndpointParams = {
  dateRange?: string;
  limit?: number;
  location?: string;
};

export type RadarEndpointDefinition = {
  name: RadarEndpointName;
  path: string;
  label: string;
  supportsPublic: boolean;
  requiredParams: Array<keyof RadarEndpointParams>;
  optionalParams: Array<keyof RadarEndpointParams>;
  defaults: Required<Pick<RadarEndpointParams, "dateRange" | "limit">> &
    Partial<Pick<RadarEndpointParams, "location">>;
};

export class RadarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadarConfigError";
  }
}

const DATE_RANGE_ALIASES: Record<string, string> = {
  last_7_days: "7d",
  last_30_days: "30d",
};

const ALLOWED_DATE_RANGES = new Set(["1d", "7d", "30d", "90d"]);

export const DEFAULT_RADAR_ENDPOINT: RadarEndpointDefinition = {
  name: "trafficCountries",
  path: "/traffic/countries",
  label: "Top Countries",
  supportsPublic: true,
  requiredParams: ["dateRange"],
  optionalParams: ["limit"],
  defaults: {
    dateRange: "7d",
    limit: 10,
  },
};

const normalizeDateRange = (value: string): string => {
  const trimmed = value.trim();
  const alias = DATE_RANGE_ALIASES[trimmed];
  const normalized = alias ?? trimmed;
  if (!ALLOWED_DATE_RANGES.has(normalized)) {
    throw new RadarConfigError(`Invalid dateRange: ${value}`);
  }
  return normalized;
};

const normalizeLimit = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new RadarConfigError("Invalid limit value");
  }
  const rounded = Math.floor(value);
  if (rounded < 1 || rounded > 50) {
    throw new RadarConfigError("Limit must be between 1 and 50");
  }
  return rounded;
};

const normalizeLocation = (value: string): string => {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) {
    throw new RadarConfigError("Location must be a 2-letter ISO country code");
  }
  return trimmed;
};

export const buildEndpointParams = (
  params: RadarEndpointParams,
  endpoint: RadarEndpointDefinition = DEFAULT_RADAR_ENDPOINT
): Required<Pick<RadarEndpointParams, "dateRange" | "limit">> & Partial<Pick<RadarEndpointParams, "location">> => {
  const dateRange = params.dateRange ?? endpoint.defaults.dateRange;
  if (!dateRange) {
    throw new RadarConfigError("Missing required parameter: dateRange");
  }

  const normalized: Required<Pick<RadarEndpointParams, "dateRange" | "limit">> &
    Partial<Pick<RadarEndpointParams, "location">> = {
    dateRange: normalizeDateRange(dateRange),
    limit: normalizeLimit(params.limit ?? endpoint.defaults.limit),
  };

  if (params.location) {
    normalized.location = normalizeLocation(params.location);
  }

  return normalized;
};
