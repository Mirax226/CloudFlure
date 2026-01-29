import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";
import { fetchIranTimeseries, type RadarTimeseriesPoint } from "./fetch.js";

const WIDTH = 1280;
const HEIGHT = 720;
const MAX_POINTS = 96;

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

export const generateRadarChartPng = async (timezone: string): Promise<Buffer> => {
  const points = downsample(await fetchIranTimeseries(), MAX_POINTS);
  const labels = points.map((point) => formatLabel(point.timestamp, timezone));
  const data = points.map((point) => point.value);
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: "white",
  });

  const configuration: ChartConfiguration<"line"> = {
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

  return chartJSNodeCanvas.renderToBuffer(configuration, "image/png");
};
