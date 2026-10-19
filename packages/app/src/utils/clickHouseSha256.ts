import SHA256 from 'crypto-js/sha256';

/**
 * Lowercase hex SHA-256 of a UTF-8 string, matching ClickHouse
 * `lower(hex(SHA256(?)))` for the same input.
 */
export function clickHouseSha256HexLower(value: string): string {
  return SHA256(value).toString();
}
