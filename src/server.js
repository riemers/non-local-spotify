import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import {
  authorizeApp,
  isAllowedSpotifyUser,
  isAppAccessConfigured,
  isAppAuthorized,
  verifyAppPassword,
} from './accessControl.js';
import { getAvailableChartSources } from './chartSources.js';
import { getConfig } from './config.js';
import { createNonDutchChartPlaylists } from './playlistService.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getCurrentUser,
} from './spotify.js';
import { getAccessTokenFromStored, sessionTokensToStored } from './spotifySession.js';
import { clearStoredTokens, loadStoredTokens, saveStoredTokens } from './tokenStore.js';

const config = getConfig();
const app = express();
const jobs = new Map();

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'non-local-spotify.sid',
    secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' ? 'auto' : false,
    },
  }),
);

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/unlock', (request, response) => {
  if (!isAppAccessConfigured(config) || isAppAuthorized(request.session)) {
    response.redirect('/');
    return;
  }

  response.type('html').send(renderUnlockPage());
});

app.post('/unlock', (request, response) => {
  if (!isAppAccessConfigured(config)) {
    response.redirect('/');
    return;
  }

  if (!verifyAppPassword(request.body.password, config)) {
    response.status(401).type('html').send(renderUnlockPage('Incorrect password.'));
    return;
  }

  authorizeApp(request.session);
  response.redirect('/');
});

app.use(requireAppAccess);

app.get('/', async (request, response, next) => {
  try {
    const stored = await loadStoredTokens(config.tokenStorePath);
    response.type('html').send(renderPage(request, config, {
      cronReady: Boolean(stored?.refreshToken),
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/login', (request, response) => {
  if (config.missingKeys.length) {
    response.status(500).type('html').send(renderError(
      `Missing environment variables: ${config.missingKeys.join(', ')}`,
    ));
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  request.session.spotifyState = state;
  response.redirect(buildAuthorizeUrl(config, state));
});

app.get('/callback', async (request, response, next) => {
  try {
    if (request.query.state !== request.session.spotifyState) {
      response.status(400).type('html').send(renderError('Spotify state mismatch.'));
      return;
    }

    const tokens = await exchangeCodeForTokens(config, request.query.code);
    const accessToken = tokens.access_token;
    const user = await getCurrentUser(accessToken);

    if (!isAllowedSpotifyUser(user, config)) {
      response.status(403).type('html').send(renderError(
        `Spotify account "${user.display_name || user.id}" is not allowed. Only the configured owner account may connect.`,
        config.allowedSpotifyUserId
          ? ''
          : `Set ALLOWED_SPOTIFY_USER_ID=${user.id} in your environment and try again.`,
      ));
      return;
    }

    saveTokens(request, tokens, '', user.id);
    delete request.session.spotifyState;

    response.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.post('/create', requireLogin, async (request, response, next) => {
  try {
    const sourceIds = parseChartSourceInputs(
      request.body.chartSources || config.chartSources.join('\n'),
    );

    if (!sourceIds.length) {
      response.status(400).type('html').send(renderError('Enter at least one chart source.'));
      return;
    }

    const accessToken = await getAccessToken(request);
    const job = createJob();
    response.redirect(`/jobs/${job.id}`);

    createNonDutchChartPlaylists(accessToken, sourceIds, config, {
      onProgress: (message) => addJobEvent(job, 'progress', { message }),
    })
      .then((results) => {
        job.results = results;
        addJobEvent(job, 'done', { message: 'Done.' });
      })
      .catch((error) => {
        job.error = error.message;
        addJobEvent(job, 'error', { message: error.message });
      });
  } catch (error) {
    next(error);
  }
});

app.get('/jobs/:jobId', (request, response) => {
  const job = jobs.get(request.params.jobId);

  if (!job) {
    response.status(404).type('html').send(renderError('Job not found.'));
    return;
  }

  response.type('html').send(renderJobPage(job));
});

app.get('/jobs/:jobId/events', (request, response) => {
  const job = jobs.get(request.params.jobId);

  if (!job) {
    response.sendStatus(404);
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  for (const event of job.events) {
    writeJobEvent(response, event);
  }

  const listener = (event) => writeJobEvent(response, event);
  job.listeners.add(listener);

  request.on('close', () => {
    job.listeners.delete(listener);
  });
});

app.get('/jobs/:jobId/result', (request, response) => {
  const job = jobs.get(request.params.jobId);

  if (!job) {
    response.status(404).type('html').send(renderError('Job not found.'));
    return;
  }

  if (job.error) {
    response.status(500).type('html').send(renderError(job.error));
    return;
  }

  if (!job.results) {
    response.redirect(`/jobs/${job.id}`);
    return;
  }

  response.type('html').send(renderResults(job.results));
});

app.post('/logout', async (request, response, next) => {
  try {
    await clearStoredTokens(config.tokenStorePath);
    request.session.destroy(() => response.redirect('/'));
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, _next) => {
  console.error(error);
  response.status(500).type('html').send(renderError(error.message));
});

app.listen(config.port, () => {
  console.log(`Server running at ${config.baseUrl}`);

  if (process.env.NODE_ENV === 'production') {
    if (!config.appAccessPassword) {
      console.warn('APP_ACCESS_PASSWORD is not set. The web UI is publicly reachable.');
    }

    if (!config.allowedSpotifyUserId) {
      console.warn('ALLOWED_SPOTIFY_USER_ID is not set. Any Spotify account could connect.');
    }
  }
});

function requireAppAccess(request, response, next) {
  if (!isAppAccessConfigured(config) || isAppAuthorized(request.session)) {
    next();
    return;
  }

  if (request.method === 'GET') {
    response.redirect('/unlock');
    return;
  }

  response.status(401).type('html').send(renderUnlockPage('Unlock the app before continuing.'));
}

function requireLogin(request, response, next) {
  if (!request.session.spotifyTokens) {
    response.redirect('/login');
    return;
  }

  next();
}

async function getAccessToken(request) {
  const sessionTokens = request.session.spotifyTokens;
  const stored = sessionTokensToStored(sessionTokens, sessionTokens.userId);

  return getAccessTokenFromStored(config, stored, async (updated) => {
    saveTokens(request, {
      access_token: updated.accessToken,
      refresh_token: updated.refreshToken,
      expires_in: Math.max(1, Math.floor((updated.expiresAt - Date.now()) / 1000)),
      scope: updated.scope,
    }, updated.refreshToken, updated.userId);
  });
}

function saveTokens(request, tokens, existingRefreshToken = '', userId = '') {
  const refreshToken = tokens.refresh_token || existingRefreshToken;
  const sessionTokens = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope || request.session.spotifyTokens?.scope || '',
    userId: userId || request.session.spotifyTokens?.userId || '',
  };

  request.session.spotifyTokens = sessionTokens;

  if (refreshToken) {
    saveStoredTokens(config.tokenStorePath, sessionTokensToStored(sessionTokens, sessionTokens.userId))
      .catch((error) => console.error('Failed to persist Spotify refresh token:', error));
  }
}

function parseChartSourceInputs(value = '') {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createJob() {
  const job = {
    id: crypto.randomBytes(12).toString('hex'),
    events: [],
    listeners: new Set(),
    results: null,
    error: '',
  };

  jobs.set(job.id, job);
  addJobEvent(job, 'progress', { message: 'Job queued.' });
  return job;
}

function addJobEvent(job, type, data) {
  const event = {
    type,
    data,
    createdAt: new Date().toISOString(),
  };

  job.events.push(event);

  for (const listener of job.listeners) {
    listener(event);
  }
}

function writeJobEvent(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function renderUnlockPage(errorMessage = '') {
  const error = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : '';

  return layout(`
    <h1>Unlock app</h1>
    <p>Enter the app password before connecting Spotify.</p>
    ${error}
    <form method="post" action="/unlock">
      <label for="password">App password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Continue</button>
    </form>
  `);
}

function renderPage(request, appConfig, pageState = {}) {
  const loggedIn = Boolean(request.session.spotifyTokens);
  const cronStatus = pageState.cronReady
    ? '<p class="muted">Daily sync token is saved. Coolify can run <code>npm run sync</code> on a schedule.</p>'
    : '<p class="muted">After you log in with Spotify once, the refresh token is saved for daily cron sync.</p>';
  const missingEnv = appConfig.missingKeys.length
    ? `<p class="error">Missing env vars: ${escapeHtml(appConfig.missingKeys.join(', '))}</p>`
    : '';
  const availableSources = getAvailableChartSources()
    .map((source) => `<li><code>${escapeHtml(source.id)}</code> - ${escapeHtml(source.name)}</li>`)
    .join('');
  const tokenScopes = request.session.spotifyTokens?.scope
    ? `<p class="muted">Granted Spotify scopes: <code>${escapeHtml(request.session.spotifyTokens.scope)}</code></p>`
    : '';

  return layout(`
    <h1>Spotify Top 40 filter</h1>
    <p>Create Spotify playlists from chart sources without tracks detected as Dutch.</p>
    ${cronStatus}
    ${missingEnv}
    ${
      loggedIn
        ? `
          <form method="post" action="/create" onsubmit="showLoadingState(this)">
            <label for="chartSources">Chart source IDs</label>
            <textarea id="chartSources" name="chartSources" placeholder="kworb-nl-daily" required>${escapeHtml(appConfig.chartSources.join('\n'))}</textarea>
            <button type="submit">Create chart playlists</button>
            <p class="loading" hidden>Creating playlists. This can take a while, especially when Spotify rate limits requests. Please keep this page open.</p>
          </form>
          <h2>Available chart sources</h2>
          <ul>${availableSources}</ul>
          ${tokenScopes}
          <form method="post" action="/logout">
            <button class="secondary" type="submit">Log out</button>
          </form>
        `
        : '<a class="button" href="/login">Log in with Spotify</a>'
    }
    <p class="muted">Note: chart pages are fetched directly and then resolved through Spotify track IDs or Spotify Search.</p>
  `);
}

function renderResults(results) {
  const resultItems = results.map(renderResult).join('');
  const successCount = results.filter((result) => !result.failed).length;

  return layout(`
    <h1>Playlists created</h1>
    <p>${successCount} of ${results.length} playlists processed successfully.</p>
    ${resultItems}
    <a class="button" href="/">Create more playlists</a>
  `);
}

function renderJobPage(job) {
  return layout(`
    <h1>Creating playlists</h1>
    <p class="loading">Working on the chart sources. This page updates live.</p>
    <ul id="events"></ul>
    <script>
      const events = document.getElementById('events');
      const stream = new EventSource('/jobs/${job.id}/events');

      function appendEvent(message) {
        const item = document.createElement('li');
        item.textContent = message;
        events.appendChild(item);
      }

      stream.addEventListener('progress', (event) => {
        appendEvent(JSON.parse(event.data).message);
      });

      stream.addEventListener('error', (event) => {
        if (event.data) {
          appendEvent(JSON.parse(event.data).message);
        }
      });

      stream.addEventListener('done', () => {
        appendEvent('Done. Opening results...');
        stream.close();
        window.location.href = '/jobs/${job.id}/result';
      });
    </script>
  `);
}

function renderResult(result) {
  if (result.failed) {
    return `
      <section>
        <h2>Skipped chart source ${escapeHtml(result.sourceId)}</h2>
        <p class="error">${escapeHtml(result.error)}</p>
      </section>
    `;
  }

  const removedItems = result.removed.length
    ? result.removed
        .map((track) => `<li>${escapeHtml(track.artists)} - ${escapeHtml(track.name)} <span>${escapeHtml(track.reason)}</span></li>`)
        .join('')
    : '<li>No tracks removed.</li>';

  return `
    <section>
      <h2>${escapeHtml(result.targetPlaylist.name)}</h2>
    <p>
      Source: <strong>${escapeHtml(result.chartSource.name)}</strong><br>
      New: <a href="${escapeHtml(result.targetPlaylist.external_urls.spotify)}">${escapeHtml(result.targetPlaylist.name)}</a>
    </p>
    <p>${result.keptTracks} of ${result.totalTracks} chart entries copied. ${result.removed.length} removed. ${result.notFound.length} not found on Spotify. ${result.cacheHits} cache hits.</p>
      <h3>Removed</h3>
    <ul>${removedItems}</ul>
    </section>
  `;
}

function renderError(message, hint = '') {
  const extra = hint ? `<p class="muted">${escapeHtml(hint)}</p>` : '';

  return layout(`
    <h1>Something went wrong</h1>
    <p class="error">${escapeHtml(message)}</p>
    ${extra}
    <a class="button" href="/">Back</a>
  `);
}

function layout(body) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Spotify Top 40 filter</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 760px; padding: 0 1rem; line-height: 1.5; }
          input, textarea { box-sizing: border-box; display: block; font: inherit; margin: .5rem 0 1rem; padding: .75rem; width: 100%; }
          textarea { min-height: 9rem; resize: vertical; }
          button, .button { background: #1db954; border: 0; border-radius: .4rem; color: #06130a; cursor: pointer; display: inline-block; font: inherit; font-weight: 700; margin: .25rem 0; padding: .75rem 1rem; text-decoration: none; }
          section { border-top: 1px solid #ddd; margin-top: 1.5rem; padding-top: 1rem; }
          .secondary { background: #e6e6e6; color: #111; }
          .error { color: #b00020; font-weight: 700; }
          .muted, li span { color: #666; }
          code { background: #f3f3f3; padding: .1rem .25rem; }
          .loading { background: #fff8d6; border: 1px solid #e4c85b; border-radius: .4rem; padding: .75rem; }
        </style>
        <script>
          function showLoadingState(form) {
            const button = form.querySelector('button[type="submit"]');
            const loading = form.querySelector('.loading');

            if (button) {
              button.disabled = true;
              button.textContent = 'Creating playlists...';
            }

            if (loading) {
              loading.hidden = false;
            }
          }
        </script>
      </head>
      <body>${body}</body>
    </html>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
