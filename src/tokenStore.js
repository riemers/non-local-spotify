import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadStoredTokens(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveStoredTokens(filePath, tokens) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken || '',
        expiresAt: tokens.expiresAt || 0,
        scope: tokens.scope || '',
        userId: tokens.userId || '',
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export async function clearStoredTokens(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}
