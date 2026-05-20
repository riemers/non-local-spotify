import {
  createPlaylist,
  getCurrentUserPlaylists,
  replacePlaylistItems,
  searchTrack,
} from './spotify.js';
import { fetchChartSource } from './chartSources.js';
import { isDutchTrack, loadDutchRules } from './dutchFilter.js';
import { getCachedTrack, setCachedTrack } from './trackCache.js';

export async function createNonDutchChartPlaylists(accessToken, sourceIds, config, options = {}) {
  const results = [];
  const reportProgress = options.onProgress || (() => {});

  for (const sourceId of sourceIds) {
    try {
      reportProgress(`Starting chart source: ${sourceId}`);
      results.push(await createNonDutchChartPlaylist(accessToken, sourceId, config, options));
    } catch (error) {
      reportProgress(`Skipped ${sourceId}: ${error.message}`);
      results.push({
        failed: true,
        sourceId,
        error: error.message,
      });
    }
  }

  return results;
}

export async function createNonDutchChartPlaylist(accessToken, sourceId, config, options = {}) {
  const reportProgress = options.onProgress || (() => {});
  const [chartSource, rules] = await Promise.all([
    fetchChartSource(sourceId),
    loadDutchRules(config),
  ]);
  reportProgress(`Fetched ${chartSource.entries.length} entries from ${chartSource.name}.`);
  const { tracks, notFound, cacheHits } = await resolveChartTracks(
    accessToken,
    chartSource.entries,
    config.trackCachePath,
    reportProgress,
  );

  const removed = [];
  const keptUris = [];
  const seenUris = new Set();

  for (const track of tracks) {
    if (!track || track.type !== 'track' || seenUris.has(track.uri)) {
      continue;
    }

    seenUris.add(track.uri);

    const result = isDutchTrack(track, rules);

    if (result.match) {
      reportProgress(`Removed: ${track.artists.map((artist) => artist.name).join(', ')} - ${track.name} (${result.reason})`);
      removed.push({
        name: track.name,
        artists: track.artists.map((artist) => artist.name).join(', '),
        reason: result.reason,
        uri: track.uri,
      });
      continue;
    }

    keptUris.push(track.uri);
  }

  const playlistName = `${chartSource.name}${config.targetPlaylistSuffix}`;
  reportProgress(`Preparing playlist: ${playlistName}`);
  const targetPlaylist = await findOrCreatePlaylist(accessToken, playlistName, chartSource);

  reportProgress(`Replacing playlist contents: ${playlistName}`);
  await replacePlaylistItems(accessToken, targetPlaylist.id, keptUris);
  reportProgress(`Finished ${playlistName}: ${keptUris.length} tracks copied, ${removed.length} removed.`);

  return {
    chartSource,
    targetPlaylist,
    totalTracks: chartSource.entries.length,
    resolvedTracks: tracks.length,
    cacheHits,
    keptTracks: keptUris.length,
    removed,
    notFound,
  };
}

async function findOrCreatePlaylist(accessToken, playlistName, chartSource) {
  const playlists = await getCurrentUserPlaylists(accessToken);
  const existingPlaylist = playlists.find((playlist) => playlist.name === playlistName);

  if (existingPlaylist) {
    return existingPlaylist;
  }

  return createPlaylist(accessToken, {
    name: playlistName,
    public: false,
    description: `Automatically created from ${chartSource.url} without detected Dutch tracks.`,
  });
}

async function resolveChartTracks(accessToken, entries, trackCachePath, reportProgress) {
  const resolvedTracks = [];
  const notFound = [];
  let cacheHits = 0;

  for (const entry of entries) {
    const label = `${entry.artist} - ${entry.title}`;
    let track = entry.spotifyTrackId ? chartEntryToTrack(entry) : null;

    if (track) {
      reportProgress(`Track ID found: ${label}`);
    }

    if (!track) {
      track = await getCachedTrack(entry, trackCachePath);

      if (track) {
        cacheHits += 1;
        reportProgress(`Cache hit: ${label}`);
      }
    }

    if (!track) {
      reportProgress(`Searching Spotify: ${label}`);
      track = await searchTrack(accessToken, entry, {
        onRateLimit: (seconds) => {
          reportProgress(`Spotify rate limit hit while searching "${label}". Waiting ${seconds}s...`);
        },
      });
      await setCachedTrack(entry, track, trackCachePath);

      if (track) {
        reportProgress(`Track found and cached: ${label}`);
      }
    }

    if (track) {
      resolvedTracks.push(track);
      continue;
    }

    notFound.push(entry);
    reportProgress(`Not found on Spotify: ${label}`);
  }

  return { tracks: resolvedTracks, notFound, cacheHits };
}

function chartEntryToTrack(entry) {
  return {
    id: entry.spotifyTrackId,
    name: entry.title,
    type: 'track',
    uri: `spotify:track:${entry.spotifyTrackId}`,
    artists: [
      {
        id: null,
        name: entry.artist,
      },
    ],
  };
}
