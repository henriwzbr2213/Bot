import { env } from './config/env';
import { buildServer } from './server';

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
