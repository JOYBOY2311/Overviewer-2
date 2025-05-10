export function normalizeUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }

  let normalized = url.trim().toLowerCase();

  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  
  // Validate if it's a plausible URL structure after normalization
  try {
    new URL(normalized); // This will throw an error if the URL is invalid
  } catch (e) {
    return undefined; // Or handle invalid URL strings as per requirements, e.g., return original
  }

  return normalized;
}
