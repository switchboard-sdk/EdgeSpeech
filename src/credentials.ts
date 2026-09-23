/**
 * Default test credentials, so the library works with none passed. Production apps
 * should override them with their own from https://console.switchboard.audio/register.
 */
export const DEFAULT_APP_ID = '6ab34ece29d531a5816c6f13'
export const DEFAULT_APP_SECRET = '42506ceccaeab7ed60b2828b3cfc4bd5c8053aaf'

/** Falls back to the defaults when the caller passes nothing or a blank string. */
export function resolveCredentials(appId?: string, appSecret?: string) {
  return {
    appId: appId && appId.trim() !== '' ? appId : DEFAULT_APP_ID,
    appSecret: appSecret && appSecret.trim() !== '' ? appSecret : DEFAULT_APP_SECRET,
  }
}
