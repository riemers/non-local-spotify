import https from 'node:https';

const CHART_SOURCES = {
  'kworb-nl-daily': {
    id: 'kworb-nl-daily',
    name: 'Spotify NL Top 200',
    url: 'https://kworb.net/spotify/country/nl_daily.html',
    parser: parseKworbChart,
  },
  'kworb-nl-daily-top-40': {
    id: 'kworb-nl-daily-top-40',
    name: 'Spotify NL Daily Top 40',
    url: 'https://kworb.net/spotify/country/nl_daily.html',
    parser: parseKworbChart,
    limit: 40,
  },
  'kworb-nl-weekly': {
    id: 'kworb-nl-weekly',
    name: 'Spotify NL Weekly Top 200',
    url: 'https://kworb.net/spotify/country/nl_weekly.html',
    parser: parseKworbChart,
  },
  'kworb-nl-weekly-top-40': {
    id: 'kworb-nl-weekly-top-40',
    name: 'Spotify NL Weekly Top 40',
    url: 'https://kworb.net/spotify/country/nl_weekly.html',
    parser: parseKworbChart,
    limit: 40,
  },
  'top40-nl': {
    id: 'top40-nl',
    name: 'Dutch Top 40',
    url: 'https://www.top40.nl/top40',
    parser: parseTop40Nl,
    limit: 40,
  },
  'mega-single-top-100': {
    id: 'mega-single-top-100',
    name: 'Single Top 100',
    url: 'https://megasingletop100.nl/SingleTop100.txt',
    parser: parseMegaSingleTop100,
  },
  'acharts-dutch-top-40': {
    id: 'acharts-dutch-top-40',
    name: 'Dutch Top 40',
    url: 'https://acharts.co/dutch_top_40',
    parser: parseAchartsDutchTop40,
  },
};

export function getAvailableChartSources() {
  return Object.values(CHART_SOURCES);
}

export async function fetchChartSource(sourceId) {
  const source = CHART_SOURCES[sourceId];

  if (!source) {
    throw new Error(`Unknown chart source: ${sourceId}`);
  }

  const body = await fetchChartText(source.url);
  const entries = source.parser(body).slice(0, source.limit || Infinity);

  if (!entries.length) {
    throw new Error(`No tracks found for chart source: ${source.name}`);
  }

  return {
    id: source.id,
    name: source.name,
    url: source.url,
    entries,
  };
}

async function fetchChartText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'non-local-spotify/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Chart source error (${response.status}) for ${url}`);
    }

    return response.text();
  } catch (error) {
    if (error.cause?.code !== 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      throw error;
    }

    return fetchChartTextWithoutCertificateVerification(url);
  }
}

function fetchChartTextWithoutCertificateVerification(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, {
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'non-local-spotify/1.0',
        },
      }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Chart source error (${response.statusCode}) for ${url}`));
          response.resume();
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

function parseKworbChart(html) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const entries = [];

  for (const row of rows) {
    const trackMatch = row.match(/<a[^>]+href=["'][^"']*\/track\/([A-Za-z0-9]+)\.html["'][^>]*>([\s\S]*?)<\/a>/i);

    if (!trackMatch) {
      continue;
    }

    const artistMatches = [...row.matchAll(/<a[^>]+href=["'][^"']*\/artist\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const artist = [...new Set(artistMatches.map((match) => cleanText(match[1])).filter(Boolean))].join(', ');
    const title = cleanText(trackMatch[2]);

    if (artist && title) {
      entries.push({
        position: entries.length + 1,
        artist,
        title,
        spotifyTrackId: trackMatch[1],
      });
    }
  }

  return entries;
}

function parseTop40Nl(html) {
  const entries = [];
  const seen = new Set();
  const detailMatches = [
    ...html.matchAll(/Details\s+([^"'\]\n]+?)\s+-\s+([^"'\]\n]+?)(?=["'\]\n])/gi),
  ];

  for (const match of detailMatches) {
    const artist = cleanText(match[1]);
    const title = cleanText(match[2]);
    const key = `${artist}::${title}`.toLowerCase();

    if (!artist || !title || seen.has(key)) {
      continue;
    }

    seen.add(key);
    entries.push({
      position: entries.length + 1,
      artist,
      title,
    });
  }

  if (entries.length) {
    return entries;
  }

  const markdownMatches = [
    ...html.matchAll(/##\s+(.+?)\s*\n[\s\S]*?###\s+(.+?)\s*(?:\n|$)/g),
  ];

  for (const match of markdownMatches) {
    const title = cleanText(match[1]);
    const artist = cleanText(match[2]);

    if (artist && title) {
      entries.push({
        position: entries.length + 1,
        artist,
        title,
      });
    }
  }

  return entries;
}

function parseMegaSingleTop100(text) {
  const entries = [];

  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d{1,3})\s+\([^)]*\)\s+\d+\s+\d+x\s+\d+\s+(.+?)\s*$/);

    if (!match || !match[2].includes('-')) {
      continue;
    }

    const [artist, ...titleParts] = match[2].split('-');
    const title = titleParts.join('-');

    entries.push({
      position: Number(match[1]),
      artist: toTitleCase(cleanText(artist)),
      title: toTitleCase(cleanText(title)),
    });
  }

  return entries;
}

function parseAchartsDutchTop40(html) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const entries = [];

  for (const row of rows) {
    const position = Number(cleanText(row.match(/<td[^>]*>\s*(\d{1,3})\.?/i)?.[1] || ''));
    const songMatch = row.match(/<a[^>]+href=["'][^"']*\/song\/[^"']+["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)peak position/i);

    if (!position || !songMatch) {
      continue;
    }

    const title = cleanText(songMatch[1]);
    const artist = cleanText(songMatch[2])
      .replace(/^(Greatest Gain|Highest Debut|Biggest Fall|Longest on Chart)\s+/i, '');

    if (artist && title) {
      entries.push({ position, artist, title });
    }
  }

  return entries;
}

function cleanText(value = '') {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&euml;/g, 'e')
    .replace(/&eacute;/g, 'e')
    .replace(/&egrave;/g, 'e')
    .replace(/&ouml;/g, 'o')
    .replace(/&uuml;/g, 'u');
}

function toTitleCase(value = '') {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
