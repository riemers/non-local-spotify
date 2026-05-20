import { readFile } from 'node:fs/promises';
import { normalizeName } from './config.js';

const DEFAULT_RULES_PATH = new URL('../config/dutch-filter.json', import.meta.url);

const DUTCH_GENRE_PATTERNS = [
  'nederpop',
  'levenslied',
  'dutch hip hop',
  'dutch rap',
  'dutch r&b',
  'dutch rock',
  'dutch cabaret',
  'dutch drill',
  'dutch pop',
];

const DUTCH_TITLE_WORDS = new Set([
  'aan',
  'achter',
  'alles',
  'als',
  'altijd',
  'ben',
  'bent',
  'bij',
  'blij',
  'daar',
  'dan',
  'dat',
  'de',
  'deze',
  'die',
  'dit',
  'doe',
  'door',
  'een',
  'ga',
  'gaan',
  'geen',
  'heb',
  'heel',
  'het',
  'hier',
  'hoe',
  'iets',
  'ik',
  'in',
  'jij',
  'jou',
  'jouw',
  'kan',
  'kom',
  'laat',
  'leven',
  'liefde',
  'maar',
  'me',
  'meer',
  'met',
  'mij',
  'mijn',
  'moet',
  'naar',
  'nacht',
  'niet',
  'nog',
  'nooit',
  'nu',
  'of',
  'om',
  'ons',
  'ooit',
  'op',
  'over',
  'samen',
  'te',
  'terug',
  'toch',
  'tot',
  'uit',
  'van',
  'vandaag',
  'veel',
  'voor',
  'waar',
  'waarom',
  'was',
  'wat',
  'weer',
  'weg',
  'wel',
  'we',
  'wij',
  'wil',
  'zonder',
  'zou',
]);

export async function loadDutchRules(config) {
  const fileRules = await readRulesFile();

  return {
    trackIds: new Set([...fileRules.trackIds, ...config.dutchTrackIds]),
    artists: new Set([
      ...fileRules.artists.map(normalizeName),
      ...config.dutchArtists,
    ]),
    autoDetectDutch: config.autoDetectDutch,
    titleWords: new Set([
      ...DUTCH_TITLE_WORDS,
      ...readStringArray(fileRules.titleWords).map(normalizeName),
      ...config.dutchTitleWords,
    ]),
    tracks: fileRules.tracks.map((track) => ({
      title: normalizeName(track.title),
      artist: normalizeName(track.artist),
    })),
  };
}

export function isDutchTrack(spotifyTrack, rules, artistMetadata = new Map()) {
  if (!spotifyTrack?.id) {
    return { match: false, reason: '' };
  }

  if (rules.trackIds.has(spotifyTrack.id)) {
    return { match: true, reason: `track-id: ${spotifyTrack.id}` };
  }

  const artists = spotifyTrack.artists || [];
  const matchingArtist = artists.find((artist) => matchesArtistRule(artist.name, rules.artists));

  if (matchingArtist) {
    return { match: true, reason: `artist: ${matchingArtist.name}` };
  }

  const title = normalizeName(spotifyTrack.name);
  const matchingTrack = rules.tracks.find((rule) => {
    return rule.title === title && artists.some((artist) => normalizeName(artist.name) === rule.artist);
  });

  if (matchingTrack) {
    return { match: true, reason: `track: ${spotifyTrack.name}` };
  }

  if (rules.autoDetectDutch) {
    const genreMatch = getDutchGenreMatch(artists, artistMetadata);

    if (genreMatch) {
      return { match: true, reason: `artist genre: ${genreMatch}` };
    }

    const titleScore = getDutchTitleScore(spotifyTrack.name, rules.titleWords);

    if (titleScore >= 2) {
      return { match: true, reason: `Dutch-looking title: ${spotifyTrack.name}` };
    }
  }

  return { match: false, reason: '' };
}

function getDutchGenreMatch(artists, artistMetadata) {
  for (const artist of artists) {
    const metadata = artistMetadata.get(artist.id);
    const genres = metadata?.genres || [];
    const match = genres.find((genre) => {
      const normalizedGenre = normalizeName(genre);
      return DUTCH_GENRE_PATTERNS.some((pattern) => normalizedGenre.includes(pattern));
    });

    if (match) {
      return `${artist.name} / ${match}`;
    }
  }

  return '';
}

function matchesArtistRule(artistName, artistRules) {
  const normalizedArtist = normalizeName(artistName);

  for (const artistRule of artistRules) {
    if (normalizedArtist === artistRule || normalizedArtist.includes(artistRule)) {
      return true;
    }
  }

  return false;
}

function getDutchTitleScore(title, titleWords) {
  const words = normalizeName(title)
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);

  return words.filter((word) => titleWords.has(word)).length;
}

async function readRulesFile() {
  try {
    const contents = await readFile(DEFAULT_RULES_PATH, 'utf8');
    const rules = JSON.parse(contents);

    return {
      trackIds: readStringArray(rules.trackIds),
      artists: readStringArray(rules.artists),
      titleWords: readStringArray(rules.titleWords),
      tracks: Array.isArray(rules.tracks) ? rules.tracks : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { trackIds: [], artists: [], tracks: [] };
    }

    throw error;
  }
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}
