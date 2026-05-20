import { getConfig } from './config.js';
import { createNonDutchChartPlaylists } from './playlistService.js';
import { getAccessTokenFromStored } from './spotifySession.js';
import { loadStoredTokens, saveStoredTokens } from './tokenStore.js';

const config = getConfig();

if (config.missingKeys.length) {
  console.error(`Missing environment variables: ${config.missingKeys.join(', ')}`);
  process.exit(1);
}

const stored = await loadStoredTokens(config.tokenStorePath);

if (!stored?.refreshToken) {
  console.error(
    `No stored Spotify refresh token at ${config.tokenStorePath}. Log in once via the web UI with your allowed Spotify account.`,
  );
  process.exit(1);
}

let accessToken;

try {
  accessToken = await getAccessTokenFromStored(config, stored, async (updated) => {
    await saveStoredTokens(config.tokenStorePath, updated);
  });
} catch (error) {
  console.error(`Failed to refresh Spotify access token: ${error.message}`);
  process.exit(1);
}

const sourceIds = config.chartSources;

if (!sourceIds.length) {
  console.error('CHART_SOURCES is empty. Set at least one chart source ID.');
  process.exit(1);
}

console.log(`Syncing chart sources: ${sourceIds.join(', ')}`);

const results = await createNonDutchChartPlaylists(accessToken, sourceIds, config, {
  onProgress: (message) => console.log(message),
});

let failed = 0;

for (const result of results) {
  if (result.failed) {
    failed += 1;
    console.error(`[failed] ${result.sourceId}: ${result.error}`);
    continue;
  }

  console.log(
    `[ok] ${result.targetPlaylist.name}: ${result.keptTracks}/${result.totalTracks} kept, ${result.removed.length} removed`,
  );
}

if (failed) {
  process.exit(1);
}

console.log('Sync finished successfully.');
