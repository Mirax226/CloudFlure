import axios, { type AxiosError, type AxiosResponse } from "axios";
import { logError } from "./logger.js";

const http = axios.create();

http.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const details = {
      url: error.config?.url ?? "unknown",
      method: error.config?.method?.toUpperCase() ?? "unknown",
      status: error.response?.status ?? null,
      response: error.response?.data ?? error.message,
    };

    await logError("HTTP request failed", { details });
    return Promise.reject(error);
  }
);

export { http };
