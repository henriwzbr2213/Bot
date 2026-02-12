import type { Region } from '@discloud-gke/shared';

export interface BuildJobPayload {
  appId: string;
  ownerId: string;
  region: Region;
  zipGsUrl: string;
  image: string;
}

export interface BuildQueue {
  enqueueBuild(payload: BuildJobPayload): Promise<void>;
}

export class InlineBuildQueue implements BuildQueue {
  constructor(private readonly executor: (payload: BuildJobPayload) => Promise<void>) {}

  async enqueueBuild(payload: BuildJobPayload): Promise<void> {
    await this.executor(payload);
  }
}
