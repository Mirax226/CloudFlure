import axios from "axios";

const WIDTH = 1280;
const HEIGHT = 720;
const MAX_POINTS = 20;

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

export type RadarChartSeries = {
  labels: string[];
  values: number[];
  title: string;
};

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

const sliceSeries = (series: RadarChartSeries): RadarChartSeries => {
  if (series.labels.length <= MAX_POINTS) {
    return series;
  }
  return {
    ...series,
    labels: series.labels.slice(0, MAX_POINTS),
    values: series.values.slice(0, MAX_POINTS),
  };
};

export const generateRadarChartPng = async (series: RadarChartSeries, timezone: string): Promise<Buffer> => {
  if (!Array.isArray(series.labels) || series.labels.length === 0 || series.labels.length !== series.values.length) {
    throw new ChartRenderError("CHART_INVALID_DATA", "Radar data validation failed");
  }

  const trimmed = sliceSeries(series);

  const configuration = {
    type: "bar",
    data: {
      labels: trimmed.labels,
      datasets: [
        {
          data: trimmed.values,
          label: trimmed.title,
          backgroundColor: "rgba(243, 128, 32, 0.6)",
          borderColor: "#f38020",
          borderWidth: 1,
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
            autoSkip: false,
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
      { responseType: "arraybuffer", timeout: 10_000 }
    );

    return Buffer.from(response.data);
  } catch (error) {
    throw new ChartRenderError("CHART_RENDER_FAILED", "Chart rendering failed", error);
  }
};
