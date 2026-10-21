import type { Platform } from './types';

export interface PlatformInfo {
  hosts: string[];
  /** Captures the conversation ID from a pathname. */
  conversationPath: RegExp;
  /** Host access is granted at runtime rather than at install. */
  optional: boolean;
}
export const PLATFORMS: Partial<Record<Platform, PlatformInfo>> = {
  ChatGPT: {
    hosts: ['chatgpt.com', 'chat.openai.com'],
    conversationPath: /\/c\/([^/]+)/,
    optional: false,
  },
  Claude: { hosts: ['claude.ai'], conversationPath: /\/chat\/([^/]+)/, optional: true },
};
export const CLAUDE_ORIGINS = ['https://claude.ai/*'];
export function platformOf(url?: string): Platform | undefined {
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol !== 'https:') return undefined;
    return (Object.keys(PLATFORMS) as Platform[]).find((platform) =>
      PLATFORMS[platform]!.hosts.includes(parsed.hostname),
    );
  } catch {
    return undefined;
  }
}
export const isSupportedUrl = (url?: string) => !!platformOf(url);
export function conversationIdOf(platform: Platform, pathname: string): string | undefined {
  return PLATFORMS[platform]?.conversationPath.exec(pathname)?.[1];
}
