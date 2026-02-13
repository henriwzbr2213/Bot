import { env } from '../config/env';
import type {
  CreateFeatherServerInput,
  CreateFeatherUserInput,
  FeatherAllocation,
  FeatherLocation,
  FeatherNode,
  FeatherServer,
  FeatherUser
} from '../types';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

type JsonApiItem<T> = { attributes?: T };
type PanelWrapped<T> = { success?: boolean; data?: T; message?: string };

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
  private readonly appPrefixes = ['/api/application', '/api/v1/application'];

  constructor() {
    if (!env.FEATHER_BASE_URL || !env.FEATHER_APP_KEY) {
      throw new Error('FeatherPanel client not configured. Set FEATHER_BASE_URL and FEATHER_APP_KEY.');
    }
    this.baseUrl = env.FEATHER_BASE_URL;
    this.appKey = env.FEATHER_APP_KEY;
  }

  private endpoint(prefix: string, path: string) {
    return `${this.baseUrl}${prefix}${path}`;
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private summarizeBody(raw: string) {
    if (!raw) return 'empty response body';
    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }

  private shouldFallbackPrefix(status: number, bodySummary: string) {
    if (status !== 404) return false;
    return bodySummary.includes('api route does not exist') || bodySummary.includes('Not Found');
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: FeatherPanelApiError | undefined;

    for (const prefix of this.appPrefixes) {
      const url = this.endpoint(prefix, path);

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

        const error = new FeatherPanelApiError(response.status, `${prefix}${path}`, summary);
        if (this.shouldFallbackPrefix(response.status, summary)) {
          lastError = error;
          break;
        }

        throw error;
      }
    }

    if (lastError) throw lastError;
    throw new Error(`Unexpected retry flow for FeatherPanel endpoint ${path}`);
  }

  private unwrapOne<T>(payload: unknown): T {
    const asWrapped = payload as PanelWrapped<T>;
    if (asWrapped?.data && typeof asWrapped.data === 'object') {
      return asWrapped.data;
    }

    const asJsonApi = payload as { attributes?: T; data?: JsonApiItem<T> | T };
    if (asJsonApi.attributes) return asJsonApi.attributes;
    if (asJsonApi.data && typeof asJsonApi.data === 'object') {
      const maybeItem = asJsonApi.data as JsonApiItem<T>;
      return maybeItem.attributes ?? (asJsonApi.data as T);
    }

    return payload as T;
  }

  private unwrapMany<T>(payload: unknown): T[] {
    const asWrapped = payload as PanelWrapped<T[] | JsonApiItem<T>[]>;
    if (Array.isArray(asWrapped?.data)) {
      return asWrapped.data.map((item) => {
        const maybeItem = item as JsonApiItem<T>;
        return maybeItem.attributes ?? (item as T);
      });
    }

    const asJsonApi = payload as { data?: JsonApiItem<T>[] | T[] };
    if (Array.isArray(asJsonApi.data)) {
      return asJsonApi.data.map((item) => {
        const maybeItem = item as JsonApiItem<T>;
        return maybeItem.attributes ?? (item as T);
      });
    }

    return [];
  }

  async createUser(input: CreateFeatherUserInput): Promise<FeatherUser> {
    const response = await this.request<unknown>('POST', '/users', input);
    return this.unwrapOne<FeatherUser>(response);
  }

  async listNodes(): Promise<FeatherNode[]> {
    const response = await this.request<unknown>('GET', '/nodes');
    return this.unwrapMany<FeatherNode>(response);
  }

  async listLocations(): Promise<FeatherLocation[]> {
    const response = await this.request<unknown>('GET', '/locations');
    return this.unwrapMany<FeatherLocation>(response);
  }

  async listNodeAllocations(nodeId: number): Promise<FeatherAllocation[]> {
    const response = await this.request<unknown>('GET', `/nodes/${nodeId}/allocations`);
    return this.unwrapMany<FeatherAllocation>(response);
  }

  async createServer(input: CreateFeatherServerInput): Promise<FeatherServer> {
    // TODO: validate docs.html required fields if panel schema differs (nest, limits shape, etc).
    const response = await this.request<unknown>('POST', '/servers', input);
    return this.unwrapOne<FeatherServer>(response);
  }
}
