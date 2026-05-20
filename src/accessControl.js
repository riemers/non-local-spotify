import crypto from 'node:crypto';

export function isAppAccessConfigured(config) {
  return Boolean(config.appAccessPassword);
}

export function isAppAuthorized(session) {
  return Boolean(session?.appAuthorized);
}

export function authorizeApp(session) {
  session.appAuthorized = true;
}

export function verifyAppPassword(password, config) {
  if (!config.appAccessPassword) {
    return true;
  }

  const expected = Buffer.from(config.appAccessPassword);
  const provided = Buffer.from(String(password));

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

export function isAllowedSpotifyUser(user, config) {
  if (!config.allowedSpotifyUserId) {
    return true;
  }

  return user?.id === config.allowedSpotifyUserId;
}
