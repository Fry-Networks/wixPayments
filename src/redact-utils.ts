/**
 * Redacts an email address to prevent logging sensitive information.
 * @param email The email address to redact.
 * @returns A redacted email address (e.g., "u***r@d****n.com").
 */
export function redactEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return 'invalid-email';
  }
  const [user, domain] = email.split('@');
  const [domainName, domainTld] = domain.split('.');
  
  const redactedUser = user.length > 2 ? `${user.slice(0, 1)}***` : '***';
  const redactedDomain = domainName.length > 2 ? `${domainName.slice(0, 1)}***` : '***';
  
  return `${redactedUser}@${redactedDomain}.${domainTld}`;
}

/**
 * Truncates a long key or token for safe logging.
 * @param key The key to truncate.
 * @returns A truncated key (e.g., "prefix...suffix").
 */
export function redactKey(key: string): string {
  if (!key || typeof key !== 'string' || key.length < 12) {
    return 'invalid-key';
  }
  const prefix = key.slice(0, 8);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Redacts a token object, typically containing access or refresh tokens.
 * @param token The token object to redact.
 * @returns A new object with redacted token values.
 */
export function redactToken(token: any): any {
    if (!token) return token;

    const redacted = { ...token };

    if (redacted.access_token) {
        redacted.access_token = redactKey(redacted.access_token);
    }
    if (redacted.refresh_token) {
        redacted.refresh_token = redactKey(redacted.refresh_token);
    }
    if (redacted.id_token) {
        redacted.id_token = redactKey(redacted.id_token);
    }

    return redacted;
}
