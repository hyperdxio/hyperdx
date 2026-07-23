/** MCP client information, e.g. name "cursor", version "1.2.3". */
export type McpClientInfo = {
  name?: string;
  version?: string;
};

/** Parse the first User-Agent product into bounded client identity fields. */
export function userAgentClientInfo(rawUserAgent?: string): McpClientInfo {
  const product = rawUserAgent?.trim().split(/\s+/, 1)[0];
  if (!product) {
    return {};
  }

  const separator = product.indexOf('/');
  const rawName = separator === -1 ? product : product.slice(0, separator);
  if (!rawName) {
    return {};
  }

  const rawVersion =
    separator === -1 ? undefined : product.slice(separator + 1);
  return {
    name: rawName.slice(0, 32).toLowerCase(),
    version: rawVersion ? rawVersion.slice(0, 32) : undefined,
  };
}
