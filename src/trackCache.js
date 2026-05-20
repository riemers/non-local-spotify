import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeName } from './config.js';

let cache = null;
let cachePath = '';

export async function getCachedTrack(entry, filePath) {
  await ensureCacheLoaded(filePath);
  return cache[getCacheKey(entry)] || null;
}

export async function setCachedTrack(entry, track, filePath) {
  if (!track) {
    return;
  }

  await ensureCacheLoaded(filePath);
  cache[getCacheKey(entry)] = simplifyTrack(track);
  await persistCache();
}

export function getCacheKey(entry) {
  return `${normalizeName(entry.artist)}::${normalizeName(entry.title)}`;
}

async function ensureCacheLoaded(filePath) {
  if (cache && cachePath === filePath) {
    return;
  }

  cachePath = filePath;

  try {
    const contents = await readFile(cachePath, 'utf8');
    cache = JSON.parse(contents);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    cache = {};
  }
}

async function persistCache() {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

function simplifyTrack(track) {
  return {
    id: track.id,
    name: track.name,
    type: 'track',
    uri: track.uri,
    artists: (track.artists || []).map((artist) => ({
      id: artist.id || null,
      name: artist.name,
    })),
  };
}
