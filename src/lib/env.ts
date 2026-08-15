/**
 * Centralised environment access.
 *
 * Server-only secrets are read lazily through `requireEnv` so that a missing
 * variable fails loudly at the point of use with a useful message, rather than
 * silently producing `undefined` deep inside a provider SDK.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example for the full list.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

/** Absolute base URL of this deployment, used to build payment links. */
export function appUrl(): string {
  const explicit = optionalEnv('NEXT_PUBLIC_APP_URL');
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = optionalEnv('VERCEL_URL');
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}
