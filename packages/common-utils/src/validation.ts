function extractDomainFromUrl(url: string): string {
  const hostname = new URL(url).hostname;
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidSlackUrl(url: string): boolean {
  return isValidUrl(url) && extractDomainFromUrl(url) === 'slack.com';
}
