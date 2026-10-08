export const RELEASES: string
export function detectOS (platform?: string, userAgent?: string): 'mac' | 'windows' | 'linux' | 'mobile' | 'other'
export function inviteFromHash (hash?: string): string | null
export function appLink (code: string): string
export const DOWNLOADS: Record<string, { label: string, file: string, how: string }>
