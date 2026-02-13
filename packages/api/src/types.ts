export type FreeTierProvisionInput = {
  discordUserId: string;
  locationId?: number;
  nodeId?: number;
  serverPresetId: string;
  serverName?: string;
};

export type FreeTierProvisionOutput = {
  panelUserId: number;
  email: string;
  password: string;
  serverId?: number;
  serverUuid?: string;
  nodeId: number;
  allocationId: number;
};

export type FeatherApplicationListResponse<T> = {
  object?: string;
  data?: Array<{
    object?: string;
    attributes: T;
  }>;
  meta?: unknown;
};

export type FeatherNode = {
  id: number;
  location_id?: number;
  locationId?: number;
  name?: string;
  fqdn?: string;
  maintenance_mode?: boolean;
  maintenanceMode?: boolean;
};

export type FeatherLocation = {
  id: number;
  short?: string;
  long?: string;
};

export type FeatherAllocation = {
  id: number;
  node?: number;
  ip?: string;
  port?: number;
  assigned?: boolean;
  server_id?: number | null;
};

export type FeatherUser = {
  id: number;
  email?: string;
  username?: string;
};

export type FeatherServer = {
  id: number;
  uuid?: string;
  identifier?: string;
  name?: string;
};

export type CreateFeatherUserInput = {
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  password: string;
};

export type CreateFeatherServerInput = {
  name: string;
  user: number;
  egg: number;
  docker_image: string;
  startup: string;
  environment: Record<string, string>;
  limits: {
    memory: number;
    disk: number;
    cpu: number;
    swap: number;
    io: number;
  };
  feature_limits: {
    allocations: number;
    databases: number;
    backups: number;
  };
  allocation: {
    default: number;
  };
};
