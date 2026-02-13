import { provisionFreeTier } from './freeTier';

async function runExample() {
  const result = await provisionFreeTier({
    discordUserId: '123456789012345678',
    serverPresetId: 'bot-nodejs',
    // locationId: 1,
    // nodeId: 2,
    serverName: 'free-tier-bot'
  });

  console.log('Provisioned Free Tier server:', {
    panelUserId: result.panelUserId,
    email: result.email,
    serverId: result.serverId,
    serverUuid: result.serverUuid,
    nodeId: result.nodeId,
    allocationId: result.allocationId
  });
}

runExample().catch((error) => {
  console.error('Failed to provision Free Tier server:', error);
  process.exit(1);
});
