export type Region = 'br' | 'us';

export type PlanId = 'neurion-basic' | 'canary-premium';

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
  id: PlanId;
  label: string;
  roleName: string;
  maxUploadMb: number;
  cpuLimit: string;
  maxHostedBots: number;
}

export const USER_PLANS: PlanInfo[] = [
  {
    id: 'neurion-basic',
    label: 'Neurion Basic',
    roleName: 'Neurion Basic',
    maxUploadMb: 200,
    cpuLimit: '1000m',
    maxHostedBots: 1
  },
  {
    id: 'canary-premium',
    label: 'Canary Premium',
    roleName: 'Canary Premium',
    maxUploadMb: 500,
    cpuLimit: '2000m',
    maxHostedBots: 3
  }
];

export const REGIONS: Array<{ id: Region; label: string; description: string }> = [
  { id: 'br', label: 'Brasil', description: 'Baixa latência para usuários BR' },
  { id: 'us', label: 'Estados Unidos', description: 'Opção mais econômica' }
];
