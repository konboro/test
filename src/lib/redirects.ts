/**
 * Post-login redirect targets come from a query parameter, which makes them
 * attacker-suppliable: a crafted /login?next=… link would otherwise bounce a
 * freshly signed-in user anywhere. Only a same-site path is ever followed.
 *
 * `/foo` is a path, but `//evil.com` is a protocol-relative URL and `/\evil.com`
 * becomes one in browsers that treat a backslash as a slash — both would leave
 * the site. Anything that fails the check falls back to the dashboard.
 */
export function safeNextPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
