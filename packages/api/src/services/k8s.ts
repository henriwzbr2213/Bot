import * as k8s from '@kubernetes/client-node';
import type { Region } from '@discloud-gke/shared';
import { env } from '../config/env';

export class K8sService {
  private kc = new k8s.KubeConfig();

  constructor() {
    this.kc.loadFromDefault();
  }

  private contextForRegion(region: Region): string {
    return region === 'br' ? env.K8S_CONTEXT_BR : env.K8S_CONTEXT_US;
  }

  async deployApp(params: {
    appId: string;
    ownerId: string;
    region: Region;
    image: string;
    namespace: string;
    deploymentName: string;
    cpuLimit: string;
  }): Promise<void> {
    if (env.MOCK_GCP) return;

    this.kc.setCurrentContext(this.contextForRegion(params.region));
    const appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api);

    await this.ensureNamespace(coreApi, params.namespace);

    const body: k8s.V1Deployment = {
      metadata: { name: params.deploymentName, namespace: params.namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: params.deploymentName } },
        template: {
          metadata: { labels: { app: params.deploymentName } },
          spec: {
            topologySpreadConstraints: [
              {
                maxSkew: 1,
                topologyKey: 'topology.kubernetes.io/zone',
                whenUnsatisfiable: 'ScheduleAnyway',
                labelSelector: { matchLabels: { app: params.deploymentName } }
              }
            ],
            containers: [
              {
                name: 'app',
                image: params.image,
                env: [
                  { name: 'APP_ID', value: params.appId },
                  { name: 'OWNER_ID', value: params.ownerId }
                ],
                resources: {
                  requests: { cpu: '100m', memory: '128Mi' },
                  limits: { cpu: params.cpuLimit, memory: '512Mi' }
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'] },
                  runAsNonRoot: true
                }
              }
            ]
          }
        }
      }
    };

    try {
      await appsApi.replaceNamespacedDeployment({ name: params.deploymentName, namespace: params.namespace, body });
    } catch {
      await appsApi.createNamespacedDeployment({ namespace: params.namespace, body });
    }
  }

  async restart(namespace: string, deploymentName: string, region: Region): Promise<void> {
    if (env.MOCK_GCP) return;
    this.kc.setCurrentContext(this.contextForRegion(region));
    const appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    await appsApi.patchNamespacedDeployment({
      name: deploymentName,
      namespace,
      body: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
      headers: { 'Content-Type': 'application/strategic-merge-patch+json' }
    });
  }

  async stop(namespace: string, deploymentName: string, region: Region): Promise<void> {
    if (env.MOCK_GCP) return;
    this.kc.setCurrentContext(this.contextForRegion(region));
    const appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    await appsApi.patchNamespacedDeploymentScale({
      name: deploymentName,
      namespace,
      body: { spec: { replicas: 0 } },
      headers: { 'Content-Type': 'application/merge-patch+json' }
    });
  }

  async logs(_namespace: string, _deploymentName: string, _region: Region): Promise<string> {
    return env.MOCK_GCP ? '[mock] logs indisponíveis no modo local' : 'TODO logs';
  }

  private async ensureNamespace(coreApi: k8s.CoreV1Api, namespace: string): Promise<void> {
    try {
      await coreApi.readNamespace({ name: namespace });
    } catch {
      await coreApi.createNamespace({ body: { metadata: { name: namespace } } });
    }
  }
}
