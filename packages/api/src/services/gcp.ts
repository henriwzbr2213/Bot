import { Storage } from '@google-cloud/storage';
import { CloudBuildClient } from '@google-cloud/cloudbuild';
import type { Region } from '@discloud-gke/shared';
import { env } from '../config/env';

export class GcpService {
  private storage = new Storage({ projectId: env.GCP_PROJECT_ID });
  private cloudBuild = new CloudBuildClient();

  getBucket(region: Region): string {
    return region === 'br' ? env.GCS_BUCKET_BR : env.GCS_BUCKET_US;
  }

  getImagePath(appId: string): string {
    return `${env.CLOUD_BUILD_REGION}-docker.pkg.dev/${env.GCP_PROJECT_ID}/${env.ARTIFACT_REGISTRY_REPO}/${appId}:latest`;
  }

  async uploadZip(region: Region, objectName: string, content: Buffer): Promise<string> {
    const bucket = this.getBucket(region);
    const gsUrl = `gs://${bucket}/${objectName}`;
    if (env.MOCK_GCP) return gsUrl;
    await this.storage.bucket(bucket).file(objectName).save(content, { resumable: false, contentType: 'application/zip' });
    return gsUrl;
  }

  async triggerCloudBuild(params: { zipGsUrl: string; image: string; appId: string; lang?: string }): Promise<void> {
    if (env.MOCK_GCP) return;

    await this.cloudBuild.createBuild({
      projectId: env.GCP_PROJECT_ID,
      build: {
        substitutions: {
          _ZIP_GS_URL: params.zipGsUrl,
          _IMAGE: params.image,
          _APP_ID: params.appId,
          _LANG: params.lang ?? ''
        },
        options: { logging: 'CLOUD_LOGGING_ONLY' },
        steps: [
          {
            name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim',
            id: 'fetch-zip',
            entrypoint: 'bash',
            args: ['-c', 'set -euo pipefail; mkdir -p /workspace/src; gsutil cp "${_ZIP_GS_URL}" /workspace/app.zip; unzip -q /workspace/app.zip -d /workspace/src']
          },
          {
            name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim',
            id: 'detect-lang',
            entrypoint: 'bash',
            args: ['-c', 'set -euo pipefail; LANG="${_LANG}"; if [[ -z "$LANG" && -f /workspace/src/package.json ]]; then LANG=node; fi; if [[ -z "$LANG" && ( -f /workspace/src/requirements.txt || -f /workspace/src/pyproject.toml ) ]]; then LANG=python; fi; if [[ -z "$LANG" && ( -f /workspace/src/pom.xml || -f /workspace/src/build.gradle ) ]]; then LANG=java; fi; test -n "$LANG"; cp /workspace/templates/$LANG/Dockerfile /workspace/src/Dockerfile']
          },
          {
            name: 'gcr.io/cloud-builders/docker',
            id: 'build',
            args: ['build', '-t', '${_IMAGE}', '/workspace/src']
          },
          {
            name: 'gcr.io/cloud-builders/docker',
            id: 'push',
            args: ['push', '${_IMAGE}']
          }
        ],
        images: [params.image]
      }
    });
  }
}
