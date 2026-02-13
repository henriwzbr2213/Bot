import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '../../.env' });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  DB_PROVIDER: z.enum(['sqlite', 'postgresql']).default('sqlite'),
  GCP_PROJECT_ID: z.string().default('local-project'),
  GCS_BUCKET_BR: z.string().default('bucket-br'),
  GCS_BUCKET_US: z.string().default('bucket-us'),
  ARTIFACT_REGISTRY_REPO: z.string().default('discloud-apps'),
  CLOUD_BUILD_REGION: z.string().default('global'),
  K8S_CONTEXT_BR: z.string().default('context-br'),
  K8S_CONTEXT_US: z.string().default('context-us'),
  K8S_NAMESPACE_PREFIX: z.string().default('ns-u-'),
  DEFAULT_PLAN: z.enum(['br', 'us']).default('us'),
  UPLOAD_MAX_MB: z.coerce.number().default(100),
  MOCK_GCP: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  FEATHER_BASE_URL: z.string().url().optional(),
  FEATHER_APP_KEY: z.string().min(1).optional(),
  FEATHER_APP_PREFIX: z.string().min(1).optional(),
});


const parsed = envSchema.parse(process.env);

if ((parsed.FEATHER_BASE_URL && !parsed.FEATHER_APP_KEY) || (!parsed.FEATHER_BASE_URL && parsed.FEATHER_APP_KEY)) {
  throw new Error('FEATHER_BASE_URL and FEATHER_APP_KEY must be set together.');
}

export const env = parsed;
