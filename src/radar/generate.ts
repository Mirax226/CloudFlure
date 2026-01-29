import axios from "axios";
import { type RadarTimeseriesPoint, validateRadarData } from "./fetch.js";

const WIDTH = 1280;
const HEIGHT = 720;
const MAX_POINTS = 96;

export type ChartErrorCode = "CHART_RENDER_FAILED" | "CHART_INVALID_DATA";

export class ChartRenderError extends Error {
  code: ChartErrorCode;

  constructor(code: ChartErrorCode, message: string, cause?: unknown) {
    super(message);
    this.code = code;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

const formatTimestamp = (timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date()).replace(",", "");
};

const formatLabel = (timestamp: string, timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(timestamp));
};

const downsample = (points: RadarTimeseriesPoint[], maxPoints: number): RadarTimeseriesPoint[] => {
  if (points.length <= maxPoints) {
    return points;
  }
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0);
};

export const generateRadarChartPng = async (
  points: RadarTimeseriesPoint[],
  timezone: string
): Promise<Buffer> => {
  if (!validateRadarData(points)) {
    throw new ChartRenderError("CHART_INVALID_DATA", "Radar data validation failed");
  }

  const trimmedPoints = downsample(points, MAX_POINTS);
  const labels = trimmedPoints.map((point) => formatLabel(point.timestamp, timezone));
  const data = trimmedPoints.map((point) => point.value);

  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          label: "Traffic",
          borderColor: "#f38020",
          backgroundColor: "rgba(243, 128, 32, 0.2)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Cloudflare Radar 🇮🇷 — ${formatTimestamp(timezone)}`,
          color: "#1f2937",
          font: { size: 24, family: "Arial" },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            color: "#374151",
          },
        },
        y: {
          grid: { color: "#e5e7eb" },
          ticks: { color: "#374151" },
        },
      },
    },
  };

  try {
    const response = await axios.post(
      "https://quickchart.io/chart",
      {
        chart: configuration,
        format: "png",
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: "white",
      },
      { responseType: "arraybuffer", timeout: 20_000 }
    );

    return Buffer.from(response.data);
  } catch (error) {
    throw new ChartRenderError("CHART_RENDER_FAILED", "Chart rendering failed", error);
  }
};
