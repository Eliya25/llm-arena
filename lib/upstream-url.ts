export function resolveUpstreamUrl(
  configuredUrl: string,
  requestUrl: string,
): string {
  return new URL(configuredUrl, requestUrl).toString();
}
