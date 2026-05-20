import 'dotenv/config';

const requiredKeys = [
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'SPOTIFY_REDIRECT_URI',
  'SESSION_SECRET',
];

export function getConfig() {
  const missingKeys = requiredKeys.filter((key) => !process.env[key]);

  return {
    port: Number(process.env.PORT || 3000),
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI,
    sessionSecret: process.env.SESSION_SECRET,
    chartSources: splitList(process.env.CHART_SOURCES || 'kworb-nl-daily'),
    targetPlaylistSuffix: process.env.TARGET_PLAYLIST_SUFFIX || ' - NO NL',
    trackCachePath: process.env.TRACK_CACHE_PATH || 'data/track-cache.json',
    tokenStorePath: process.env.SPOTIFY_TOKEN_PATH || 'data/spotify-tokens.json',
    appAccessPassword: process.env.APP_ACCESS_PASSWORD || '',
    allowedSpotifyUserId: process.env.ALLOWED_SPOTIFY_USER_ID || '',
    autoDetectDutch: process.env.AUTO_DETECT_DUTCH !== 'false',
    dutchTrackIds: splitCsv(process.env.DUTCH_TRACK_IDS),
    dutchArtists: splitCsv(process.env.DUTCH_ARTISTS).map(normalizeName),
    dutchTitleWords: splitCsv(process.env.DUTCH_TITLE_WORDS).map(normalizeName),
    missingKeys,
  };
}

export function splitCsv(value = '') {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function splitList(value = '') {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeName(value = '') {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
