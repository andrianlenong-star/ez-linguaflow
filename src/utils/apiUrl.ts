export function resolveApiBaseUrl(
  configuredBaseUrl?: string,
  currentLocation?: { origin: string; hostname: string } | null,
): string {
  const base = (configuredBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!currentLocation) return base;
  if (base === currentLocation.origin) return '';

  const host = currentLocation.hostname.toLowerCase();
  const isIntegratedHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.run.app') ||
    host.endsWith('.vercel.app');

  return isIntegratedHost ? '' : base;
}
