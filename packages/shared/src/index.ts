export type Region = 'br' | 'us';

export type AppRuntime = 'node' | 'python' | 'java' | 'unknown';

export type AppStatus =
  | 'created'
  | 'uploading'
  | 'building'
  | 'deploying'
  | 'running'
  | 'stopped'
  | 'error';

export interface PlanInfo {
  id: Region;
  label: string;
  description: string;
  priceHint: string;
}

export const PLANS: PlanInfo[] = [
  {
    id: 'br',
    label: 'Brasil (baixa latência)',
    description: 'Ideal para bots com público brasileiro.',
    priceHint: 'Maior custo / menor ping'
  },
  {
    id: 'us',
    label: 'Estados Unidos (econômico)',
    description: 'Ideal para workloads custo-efetivos.',
    priceHint: 'Menor custo / maior ping'
  }
];

export interface CreateAppInput {
  ownerDiscordId: string;
  name: string;
  region: Region;
}
