import { refreshAccessToken } from './spotify.js';

export async function getAccessTokenFromStored(config, tokens, onUpdate) {
  const expiresAt = tokens.expiresAt || 0;

  if (tokens.accessToken && Date.now() < expiresAt - 60_000) {
    return tokens.accessToken;
  }

  const refreshed = await refreshAccessToken(config, tokens.refreshToken);
  const updated = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope || tokens.scope || '',
    userId: tokens.userId || '',
  };

  if (onUpdate) {
    await onUpdate(updated);
  }

  return refreshed.access_token;
}

export function sessionTokensToStored(sessionTokens, userId = '') {
  return {
    accessToken: sessionTokens.accessToken,
    refreshToken: sessionTokens.refreshToken,
    expiresAt: sessionTokens.expiresAt,
    scope: sessionTokens.scope || '',
    userId,
  };
}
