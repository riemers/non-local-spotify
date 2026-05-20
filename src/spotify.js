const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const MAX_RETRY_AFTER_SECONDS = Number(process.env.SPOTIFY_MAX_RETRY_AFTER_SECONDS || 60);
const searchCache = new Map();
let nextSearchAt = 0;

export const scopes = [
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private',
];

export function buildAuthorizeUrl(config, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotifyClientId,
    scope: scopes.join(' '),
    redirect_uri: config.spotifyRedirectUri,
    state,
    show_dialog: 'true',
  });

  return `${SPOTIFY_ACCOUNTS_URL}/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(config, code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.spotifyRedirectUri,
  });

  return spotifyTokenRequest(config, params);
}

export async function refreshAccessToken(config, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return spotifyTokenRequest(config, params);
}

export async function spotifyRequest(accessToken, path, options = {}) {
  const { retryAttempt = 0, onRateLimit = null, ...fetchOptions } = options;
  const response = await fetch(`${SPOTIFY_API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(fetchOptions.headers || {}),
    },
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') || 2);

    if (retryAfter > MAX_RETRY_AFTER_SECONDS) {
      throw new Error(
        `Spotify rate limit is too high for ${path}: Retry-After ${retryAfter}s. ` +
          'Stop this run and try again later, or use a chart source with Spotify track IDs.',
      );
    }

    if (retryAttempt >= 8) {
      throw new Error(`Spotify API rate limit for ${path}. Spotify asked us to retry after ${retryAfter} seconds.`);
    }

    onRateLimit?.(retryAfter);
    await wait(Math.max(retryAfter, 1) * 1000);
    return spotifyRequest(accessToken, path, {
      ...fetchOptions,
      onRateLimit,
      retryAttempt: retryAttempt + 1,
    });
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const reason = body?.error?.reason ? ` (${body.error.reason})` : '';
    const message = body?.error?.message || response.statusText;
    const scopeHint = response.status === 403 && (path === '/me/playlists' || /^\/users\/[^/]+\/playlists$/.test(path))
      ? ' Make sure you logged in after granting playlist-modify-private in the Spotify consent screen.'
      : '';

    throw new Error(`Spotify API error (${response.status}) for ${path}: ${message}${reason}.${scopeHint}`);
  }

  return body;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function getCurrentUser(accessToken) {
  return spotifyRequest(accessToken, '/me');
}

export async function getPlaylist(accessToken, playlistId) {
  return spotifyRequest(accessToken, `/playlists/${playlistId}`);
}

export async function getArtists(accessToken, artistIds) {
  const artists = [];

  for (let index = 0; index < artistIds.length; index += 50) {
    const ids = artistIds.slice(index, index + 50);
    const page = await spotifyRequest(accessToken, `/artists?ids=${ids.join(',')}`);
    artists.push(...page.artists.filter(Boolean));
  }

  return artists;
}

export async function getTracks(accessToken, trackIds) {
  const tracks = [];

  for (let index = 0; index < trackIds.length; index += 50) {
    const ids = trackIds.slice(index, index + 50);
    const page = await spotifyRequest(accessToken, `/tracks?ids=${ids.join(',')}`);
    tracks.push(...page.tracks);
  }

  return tracks;
}

export async function searchTrack(accessToken, entry, options = {}) {
  const title = cleanSearchValue(entry.title);
  const artist = cleanSearchValue(entry.artist);
  const queries = [
    `track:"${title}" artist:"${artist}"`,
    `${artist} ${title}`,
  ];

  for (const query of queries) {
    const cachedTrack = searchCache.get(query);

    if (cachedTrack !== undefined) {
      return cachedTrack;
    }

    const params = new URLSearchParams({
      q: query,
      type: 'track',
      market: 'NL',
      limit: '5',
    });
    await waitForSearchSlot();
    const result = await spotifyRequest(accessToken, `/search?${params.toString()}`, {
      onRateLimit: options.onRateLimit,
    });
    const track = result.tracks?.items?.find((item) => item?.type === 'track');

    if (track) {
      searchCache.set(query, track);
      return track;
    }

    searchCache.set(query, null);
  }

  return null;
}

function cleanSearchValue(value = '') {
  return String(value)
    .replace(/^\s*\d+[\s.)-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function waitForSearchSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextSearchAt - now);
  nextSearchAt = Math.max(now, nextSearchAt) + 1000;

  if (waitMs) {
    await wait(waitMs);
  }
}

export async function getAllPlaylistTracks(accessToken, playlistId) {
  const tracks = [];
  let nextPath = `/playlists/${playlistId}/items?limit=100`;

  while (nextPath) {
    const page = await spotifyRequest(accessToken, nextPath);
    tracks.push(...page.items);
    nextPath = page.next ? page.next.replace(SPOTIFY_API_URL, '') : null;
  }

  return tracks;
}

export async function createPlaylist(accessToken, playlist) {
  return spotifyRequest(accessToken, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify(playlist),
  });
}

export async function getCurrentUserPlaylists(accessToken) {
  const playlists = [];
  let nextPath = '/me/playlists?limit=50';

  while (nextPath) {
    const page = await spotifyRequest(accessToken, nextPath);
    playlists.push(...page.items);
    nextPath = page.next ? page.next.replace(SPOTIFY_API_URL, '') : null;
  }

  return playlists;
}

export async function replacePlaylistItems(accessToken, playlistId, trackUris) {
  const firstBatch = trackUris.slice(0, 100);

  await spotifyRequest(accessToken, `/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris: firstBatch }),
  });

  if (trackUris.length > 100) {
    await addTracksToPlaylist(accessToken, playlistId, trackUris.slice(100));
  }
}

export async function addTracksToPlaylist(accessToken, playlistId, trackUris) {
  for (let index = 0; index < trackUris.length; index += 100) {
    const uris = trackUris.slice(index, index + 100);

    await spotifyRequest(accessToken, `/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris }),
    });
  }
}

export function parsePlaylistId(value = '') {
  const input = value.trim();

  if (!input) {
    return '';
  }

  if (input.startsWith('spotify:playlist:')) {
    return input.split(':').at(-1);
  }

  try {
    const url = new URL(input);
    const [, type, id] = url.pathname.split('/');

    if (type === 'playlist' && id) {
      return id;
    }
  } catch {
    // Plain playlist IDs are handled below.
  }

  return input;
}

async function spotifyTokenRequest(config, params) {
  const credentials = Buffer.from(
    `${config.spotifyClientId}:${config.spotifyClientSecret}`,
  ).toString('base64');

  const response = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error_description || body?.error || response.statusText;
    throw new Error(`Spotify login error (${response.status}): ${message}`);
  }

  return body;
}
