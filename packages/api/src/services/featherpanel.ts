import { env } from '../config/env';
import type {
  CreateFeatherServerInput,
  CreateFeatherUserInput,
  FeatherAllocation,
  FeatherApplicationListResponse,
  FeatherLocation,
  FeatherNode,
  FeatherServer,
  FeatherUser
} from '../types';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class FeatherPanelApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly responseSummary: string
  ) {
    super(`FeatherPanel API error ${status} on ${endpoint}: ${responseSummary}`);
  }
}

export class FeatherPanelClient {
  private readonly baseUrl: string;
  private readonly appKey: string;

  constructor() {
    if (!env.FEATHER_BASE_URL || !env.FEATHER_APP_KEY) {
      throw new Error('FeatherPanel client not configured. Set FEATHER_BASE_URL and FEATHER_APP_KEY.');
    }
    this.baseUrl = env.FEATHER_BASE_URL;
    this.appKey = env.FEATHER_APP_KEY;
  }

  private endpoint(path: string) {
    return `${this.baseUrl}/api/application${path}`;
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private summarizeBody(raw: string) {
    if (!raw) return 'empty response body';
    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.endpoint(path);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.appKey}`
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (response.ok) {
        if (response.status === 204) return {} as T;
        return (await response.json()) as T;
      }

      const responseText = await response.text();
      const summary = this.summarizeBody(responseText);
      if (attempt < 3 && RETRYABLE_STATUS.has(response.status)) {
        await this.sleep(200 * 2 ** (attempt - 1));
        continue;
      }

      throw new FeatherPanelApiError(response.status, path, summary);
    }

    throw new Error(`Unexpected retry flow for FeatherPanel endpoint ${path}`);
  }

  async createUser(input: CreateFeatherUserInput): Promise<FeatherUser> {
    const response = await this.request<{ attributes: FeatherUser }>('POST', '/users', input);
    return response.attributes;
  }

  async listNodes(): Promise<FeatherNode[]> {
    const response = await this.request<FeatherApplicationListResponse<FeatherNode>>('GET', '/nodes');
    return response.data?.map((item) => item.attributes) ?? [];
  }

  async listLocations(): Promise<FeatherLocation[]> {
    const response = await this.request<FeatherApplicationListResponse<FeatherLocation>>('GET', '/locations');
    return response.data?.map((item) => item.attributes) ?? [];
  }

  async listNodeAllocations(nodeId: number): Promise<FeatherAllocation[]> {
    const response = await this.request<FeatherApplicationListResponse<FeatherAllocation>>(
      'GET',
      `/nodes/${nodeId}/allocations`
    );
    return response.data?.map((item) => item.attributes) ?? [];
  }

  async createServer(input: CreateFeatherServerInput): Promise<FeatherServer> {
    // TODO: validate docs.html required fields if panel schema differs (nest, limits shape, etc).
    const response = await this.request<{ attributes: FeatherServer }>('POST', '/servers', input);
    return response.attributes;
  }
}
