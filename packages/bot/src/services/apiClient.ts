import { readFile } from 'node:fs/promises';
import type { PlanId, Region } from '@discloud-gke/shared';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface AppModel {
  id: string;
  ownerDiscordId: string;
  name: string;
  region: Region;
  status: string;
  plan: PlanId;
  maxUploadMb: number;
  cpuLimit: string;
}

interface PlanPayload {
  plan: PlanId;
  maxUploadMb: number;
  cpuLimit: string;
  maxHostedBots: number;
}

export class ApiClient {
  async listApps(ownerDiscordId: string): Promise<AppModel[]> {
    const res = await fetch(`${API_BASE_URL}/apps?ownerDiscordId=${ownerDiscordId}`);
    return res.json();
  }

  async createApp(ownerDiscordId: string, name: string, region: Region, planInfo: PlanPayload): Promise<AppModel> {
    const res = await fetch(`${API_BASE_URL}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerDiscordId, name, region, ...planInfo })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.json();
  }

  async getOrCreate(ownerDiscordId: string, name: string, region: Region, planInfo: PlanPayload): Promise<AppModel> {
    const existing = (await this.listApps(ownerDiscordId)).find((a) => a.name === name);
    return existing ?? this.createApp(ownerDiscordId, name, region, planInfo);
  }

  async uploadZip(appId: string, localPath: string): Promise<AppModel> {
    const form = new FormData();
    const buf = await readFile(localPath);
    form.append('file', new Blob([buf], { type: 'application/zip' }), 'upload.zip');
    const res = await fetch(`${API_BASE_URL}/apps/${appId}/upload`, { method: 'POST', body: form });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    return res.json();
  }

  async action(appId: string, action: 'restart' | 'stop' | 'deploy'): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/apps/${appId}/${action}`, { method: 'POST' });
    return res.json();
  }

  async move(appId: string, region: Region): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/apps/${appId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region })
    });
    return res.json();
  }

  async statusByName(ownerDiscordId: string, name: string): Promise<AppModel | undefined> {
    return (await this.listApps(ownerDiscordId)).find((a) => a.name === name);
  }

  async logs(appId: string): Promise<string> {
    const res = await fetch(`${API_BASE_URL}/apps/${appId}/logs`);
    const data = (await res.json()) as { logs: string };
    return data.logs;
  }
}


export interface FreeTierServiceModel {
  id: string;
  ownerDiscordId: string;
  type: 'bot' | 'minecraft' | 'hytale';
  targetAppId?: string;
  status: 'active' | 'suspended' | 'expired';
  endsAt: string;
  abuseStrikes: number;
  suspendReason?: string;
}

export class FreeTierApiClient extends ApiClient {
  async listFreeTierServices(ownerDiscordId: string): Promise<FreeTierServiceModel[]> {
    const res = await fetch(`${API_BASE_URL}/freetier/services?ownerDiscordId=${ownerDiscordId}`);
    return res.json();
  }

  async createFreeTierService(payload: { ownerDiscordId: string; type: 'bot' | 'minecraft' | 'hytale'; targetAppId?: string }) {
    const res = await fetch(`${API_BASE_URL}/freetier/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<FreeTierServiceModel>;
  }
}
