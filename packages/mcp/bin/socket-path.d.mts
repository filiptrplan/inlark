export function defaultDataDirectory(
  env?: Record<string, string | undefined>,
  platform?: NodeJS.Platform,
): string
export function socketPath(dataDirectory: string, platform?: NodeJS.Platform): string
