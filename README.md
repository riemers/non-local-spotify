# Non Local Spotify

A small Node.js app that logs in with your Spotify account, reads public chart sources, resolves those chart entries to Spotify tracks, and creates new playlists while removing tracks detected as Dutch.

Generated playlists are named after the chart source with ` - NO NL` appended by default, for example `Spotify NL Top 200 - NO NL`.

## Chart Sources

The app no longer reads public Spotify playlists directly, because Spotify may block playlist item access for playlists you do not own. Instead, it uses chart pages as input and creates playlists from those chart entries.

Available source IDs:

- `kworb-nl-daily`: Spotify NL daily Top 200 from Kworb. This is the best source because it includes Spotify track IDs.
- `kworb-nl-daily-top-40`: Spotify NL daily Top 40 from Kworb.
- `kworb-nl-weekly`: Spotify NL weekly Top 200 from Kworb. Also includes Spotify track IDs.
- `kworb-nl-weekly-top-40`: Spotify NL weekly Top 40 from Kworb.
- `top40-nl`: Official Dutch Top 40 from `top40.nl`. Resolved through Spotify Search.
- `mega-single-top-100`: Single Top 100 from `megasingletop100.nl`. Plain text, resolved through Spotify Search.
- `acharts-dutch-top-40`: Dutch Top 40 from Acharts. HTML table, resolved through Spotify Search.

Configure sources with:

```bash
CHART_SOURCES=top40-nl
```

## Dutch Detection

Spotify does not expose track language or reliable track nationality through the official API. This app combines configurable exact rules with best-effort automatic detection:

- Spotify track IDs in `config/dutch-filter.json`
- artist names in `config/dutch-filter.json`
- exact `artist` + `title` combinations in `config/dutch-filter.json`
- Dutch-looking title words
- optional env vars `DUTCH_TRACK_IDS`, `DUTCH_ARTISTS`, and `DUTCH_TITLE_WORDS`

Track IDs are the most precise. Artist rules remove every track by that artist.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy the environment file:

```bash
cp .env.example .env
```

3. Create a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

4. Add this redirect URI to the Spotify app:

```text
http://127.0.0.1:3000/callback
```

5. Fill `.env`:

```bash
PORT=3000
BASE_URL=http://127.0.0.1:3000
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
SESSION_SECRET=a-long-random-string
CHART_SOURCES=top40-nl
TARGET_PLAYLIST_SUFFIX=" - NO NL"
TRACK_CACHE_PATH=data/track-cache.json
SPOTIFY_MAX_RETRY_AFTER_SECONDS=60
APP_ACCESS_PASSWORD=choose-a-strong-password
ALLOWED_SPOTIFY_USER_ID=your-spotify-user-id
SPOTIFY_TOKEN_PATH=data/spotify-tokens.json
```

6. Start the app:

```bash
npm run dev
```

Then open `http://127.0.0.1:3000`, log in with Spotify, and create the chart playlists.

If Spotify requires a public redirect URL for your app, run the local app through a tunnel such as ngrok or Cloudflare Tunnel. Register the tunnel callback URL in Spotify and use the same URL in `.env`:

```bash
BASE_URL=https://your-tunnel-url
SPOTIFY_REDIRECT_URI=https://your-tunnel-url/callback
```

## Filter Rules

Edit `config/dutch-filter.json`:

```json
{
  "trackIds": ["spotify-track-id"],
  "artists": ["Dutch Artist"],
  "titleWords": ["custom", "words"],
  "tracks": [
    {
      "artist": "Dutch Artist",
      "title": "Dutch Track"
    }
  ]
}
```

You can also use env vars:

```bash
DUTCH_TRACK_IDS=trackId1,trackId2
DUTCH_ARTISTS=Artist 1,Artist 2
DUTCH_TITLE_WORDS=word1,word2
```

Automatic detection can be disabled with:

```bash
AUTO_DETECT_DUTCH=false
```

## Track Cache

Chart sources without Spotify track IDs, such as `top40-nl`, resolve tracks through Spotify Search. Successful matches are stored in `data/track-cache.json` by default, so later runs can reuse the same Spotify track IDs without searching again.

The cache is updated immediately after each track is found, not at the end of the run. The create page also opens a live progress view showing cache hits, searches, found tracks, removed tracks, and playlist replacement status.

For Coolify, mount the cache path as persistent storage if you want the cache to survive deployments:

```bash
TRACK_CACHE_PATH=data/track-cache.json
```

Spotify can sometimes return very large `Retry-After` values after repeated Search rate limits. The app fails fast instead of waiting forever when the value is above:

```bash
SPOTIFY_MAX_RETRY_AFTER_SECONDS=60
```

## Access Control

When you deploy this app on the public internet, protect it with two layers:

1. `APP_ACCESS_PASSWORD` gates the web UI. Visitors must enter this password before they can start Spotify OAuth.
2. `ALLOWED_SPOTIFY_USER_ID` blocks Spotify logins from other accounts. After OAuth, the app checks `/me` and rejects every other Spotify user ID.

Also add your own Spotify account to the allowlist in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) while the app is in Development Mode. That prevents strangers from authorizing your client ID there as well.

Find your Spotify user ID by logging in once without `ALLOWED_SPOTIFY_USER_ID` set. The rejection page shows the ID to copy into your env.

## Daily Sync (Cron)

After your first successful Spotify login, the app stores a refresh token at `SPOTIFY_TOKEN_PATH` (default `data/spotify-tokens.json`). Coolify can run the headless sync on a schedule:

```bash
npm run sync
```

The sync command uses `CHART_SOURCES` from the environment and the same Dutch filtering logic as the web UI.

With Docker Compose, persistent files live on the `spotify-data` volume at `/data`:

- `/data/spotify-tokens.json`
- `/data/track-cache.json`

Log out from the web UI clears the stored refresh token.

## Deploy To Coolify

Use the included `docker-compose.yml`. Coolify will create a persistent volume for `/data` and run the daily sync automatically at `06:00` in `Europe/Amsterdam`.

1. Push this repo to GitHub.
2. Create a new resource in Coolify and choose **Docker Compose** (not only Dockerfile).
3. Select this repository and use `docker-compose.yml`.
4. Use port `3000`.
5. Add the production redirect URI to your Spotify app, for example:

```text
https://your-domain.com/callback
```

6. Set the same value in Coolify:

```bash
BASE_URL=https://your-domain.com
SPOTIFY_REDIRECT_URI=https://your-domain.com/callback
```

7. Add the remaining secrets in Coolify:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SESSION_SECRET=...
CHART_SOURCES=top40-nl
TARGET_PLAYLIST_SUFFIX=" - NO NL"
SPOTIFY_MAX_RETRY_AFTER_SECONDS=60
APP_ACCESS_PASSWORD=...
ALLOWED_SPOTIFY_USER_ID=...
ENABLE_CRON=true
TZ=Europe/Amsterdam
```

`docker-compose.yml` already mounts a named volume at `/data` and sets:

```bash
SPOTIFY_TOKEN_PATH=/data/spotify-tokens.json
TRACK_CACHE_PATH=/data/track-cache.json
```

8. Log in once through the web UI so the refresh token is written to `/data`.

9. The container starts `supercronic` and runs `npm run sync` every day at `06:00` (`Europe/Amsterdam`). Set `ENABLE_CRON=false` if you prefer a Coolify scheduled task instead.

### Local Docker Compose

```bash
cp .env.example .env
# fill Spotify secrets and APP_ACCESS_PASSWORD / ALLOWED_SPOTIFY_USER_ID
docker compose up --build
```

For local runs without the built-in scheduler:

```bash
ENABLE_CRON=false docker compose up --build
```

## Spotify Permissions

The app requests these scopes:

- `playlist-modify-private`
- `playlist-modify-public`
- `playlist-read-private`
- `user-read-private`

The playlists are created as private by default. Existing playlists with the same generated name are reused and replaced instead of duplicated.