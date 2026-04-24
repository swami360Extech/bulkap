import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

interface OracleClientConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export class OracleRestClient {
  private client: AxiosInstance;

  constructor(config: OracleClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      auth: { username: config.username, password: config.password },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "REST-Framework-Version": "4",
      },
      timeout: 30_000,
    });

    // Retry on 503/429 up to 3 times
    this.client.interceptors.response.use(undefined, async (error) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };
      if (!config || config._retryCount === undefined) config._retryCount = 0;
      const retryableStatus = [429, 503];
      if (retryableStatus.includes(error.response?.status) && config._retryCount < 3) {
        config._retryCount++;
        const delay = Math.pow(2, config._retryCount) * 500;
        await new Promise((r) => setTimeout(r, delay));
        return this.client(config);
      }
      throw error;
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.client.get<T>(path, { params });
    return res.data;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.client.post<T>(path, body);
    return res.data;
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await this.client.patch<T>(path, body);
    return res.data;
  }
}

// Cache clients per tenant to avoid recreating on every request
const clientCache = new Map<string, OracleRestClient>();

export function getOracleClient(tenantId: string, config: OracleClientConfig): OracleRestClient {
  if (!clientCache.has(tenantId)) {
    clientCache.set(tenantId, new OracleRestClient(config));
  }
  return clientCache.get(tenantId)!;
}
