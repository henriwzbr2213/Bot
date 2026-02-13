import { randomBytes } from 'node:crypto';
import { FeatherPanelClient } from '../services/featherpanel';
import type {
  CreateFeatherServerInput,
  FeatherAllocation,
  FeatherNode,
  FreeTierProvisionInput,
  FreeTierProvisionOutput
} from '../types';

const FREE_TIER_LIMITS = {
  memory: 1024,
  disk: 2048,
  cpu: 50,
  swap: 0,
  io: 500,
  allocations: 1,
  databases: 0,
  backups: 0
} as const;

export const PRESETS: Record<
  string,
  {
    eggId: number;
    dockerImage: string;
    startup: string;
    environment: Record<string, string>;
  }
> = {
  // Ajuste eggId/dockerImage/startup/environment conforme seu painel.
  'bot-nodejs': {
    eggId: 15,
    dockerImage: 'ghcr.io/pterodactyl/yolks:nodejs_20',
    startup: 'npm start',
    environment: {
      NODE_ENV: 'production'
    }
  },
  // Ajuste eggId/dockerImage/startup/environment conforme seu painel.
  'minecraft-paper': {
    eggId: 16,
    dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
    startup: 'java -Xms128M -Xmx1024M -jar server.jar',
    environment: {
      VERSION: '1.20.6',
      BUILD_NUMBER: 'latest'
    }
  }
};

export class ProvisionError extends Error {}

function sanitizeDiscordId(discordUserId: string) {
  return discordUserId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
}

function generateStrongPassword(length = 20) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{};:,.?';
  const all = upper + lower + numbers + symbols;

  if (length < 4) throw new ProvisionError('Password length must be >= 4');

  const pick = (chars: string) => chars[randomBytes(1)[0] % chars.length];
  const initial = [pick(upper), pick(lower), pick(numbers), pick(symbols)];
  while (initial.length < length) initial.push(pick(all));

  for (let i = initial.length - 1; i > 0; i -= 1) {
    const j = randomBytes(1)[0] % (i + 1);
    [initial[i], initial[j]] = [initial[j], initial[i]];
  }

  return initial.join('');
}

function parseNodeLocationId(node: FeatherNode): number | undefined {
  return node.location_id ?? node.locationId;
}

function pickFreeAllocation(allocations: FeatherAllocation[]): FeatherAllocation | undefined {
  return allocations.find((item) => item.assigned === false || item.server_id == null);
}

function validateInput(input: FreeTierProvisionInput) {
  if (!input.discordUserId?.trim()) {
    throw new ProvisionError('discordUserId is required');
  }

  if (!input.serverPresetId?.trim()) {
    throw new ProvisionError('serverPresetId is required');
  }

  if (!PRESETS[input.serverPresetId]) {
    throw new ProvisionError(`Unknown serverPresetId: ${input.serverPresetId}`);
  }

  if (input.locationId !== undefined && (!Number.isInteger(input.locationId) || input.locationId <= 0)) {
    throw new ProvisionError('locationId must be a positive integer');
  }

  if (input.nodeId !== undefined && (!Number.isInteger(input.nodeId) || input.nodeId <= 0)) {
    throw new ProvisionError('nodeId must be a positive integer');
  }
}

async function resolveNodeCandidates(client: FeatherPanelClient, input: FreeTierProvisionInput): Promise<FeatherNode[]> {
  const nodes = await client.listNodes();
  if (nodes.length === 0) throw new ProvisionError('No nodes available in FeatherPanel');

  if (input.nodeId) {
    const exact = nodes.find((node) => node.id === input.nodeId);
    if (!exact) throw new ProvisionError(`Node ${input.nodeId} not found`);
    return [exact];
  }

  if (input.locationId) {
    const locations = await client.listLocations();
    const locationExists = locations.some((location) => location.id === input.locationId);
    if (!locationExists) {
      throw new ProvisionError(`Location ${input.locationId} not found`);
    }

    const filtered = nodes.filter((node) => parseNodeLocationId(node) === input.locationId);
    if (filtered.length === 0) {
      throw new ProvisionError(`No nodes found for location ${input.locationId}`);
    }
    return filtered;
  }

  return nodes.filter((node) => !node.maintenance_mode && !node.maintenanceMode);
}

async function findNodeAndAllocation(
  client: FeatherPanelClient,
  candidates: FeatherNode[]
): Promise<{ nodeId: number; allocationId: number }> {
  for (const node of candidates) {
    const allocations = await client.listNodeAllocations(node.id);
    const free = pickFreeAllocation(allocations);
    if (free) {
      return { nodeId: node.id, allocationId: free.id };
    }
  }

  throw new ProvisionError('No free allocations available');
}

export async function provisionFreeTier(input: FreeTierProvisionInput): Promise<FreeTierProvisionOutput> {
  validateInput(input);

  const client = new FeatherPanelClient();
  const safeDiscordId = sanitizeDiscordId(input.discordUserId);
  const timestamp = Date.now();

  const email = `ft-${safeDiscordId}-${timestamp}@free.loisax.local`;
  const username = `ft_${safeDiscordId}`.slice(0, 32);
  const password = generateStrongPassword(20);

  const user = await client.createUser({
    email,
    username,
    first_name: 'Free',
    last_name: 'Tier',
    password
  });

  const candidates = await resolveNodeCandidates(client, input);
  const { nodeId, allocationId } = await findNodeAndAllocation(client, candidates);

  const preset = PRESETS[input.serverPresetId];
  const serverName = input.serverName?.trim() || `ft-${input.serverPresetId}-${safeDiscordId}`;

  const payload: CreateFeatherServerInput = {
    name: serverName,
    user: user.id,
    egg: preset.eggId,
    docker_image: preset.dockerImage,
    startup: preset.startup,
    environment: preset.environment,
    limits: {
      memory: FREE_TIER_LIMITS.memory,
      disk: FREE_TIER_LIMITS.disk,
      cpu: FREE_TIER_LIMITS.cpu,
      swap: FREE_TIER_LIMITS.swap,
      io: FREE_TIER_LIMITS.io
    },
    feature_limits: {
      allocations: FREE_TIER_LIMITS.allocations,
      databases: FREE_TIER_LIMITS.databases,
      backups: FREE_TIER_LIMITS.backups
    },
    allocation: { default: allocationId }
  };

  // TODO: caso docs.html exija campos adicionais (nest, deploy, external_id), incluir aqui.
  const server = await client.createServer(payload);

  return {
    panelUserId: user.id,
    email,
    password,
    serverId: server.id,
    serverUuid: server.uuid ?? server.identifier,
    nodeId,
    allocationId
  };
}
