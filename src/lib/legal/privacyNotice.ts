/**
 * Privacy notice identity.
 *
 * PRIVACY_NOTICE_VERSION must match public.privacy_notice_version() in
 * supabase/migrations/20260922180800_consents.sql. The booking RPC rejects any
 * other value, so when the notice text changes both must be bumped together.
 */
export const PRIVACY_NOTICE_DOCUMENT = "aviso_privacidad";
export const PRIVACY_NOTICE_VERSION = "2026-09-23";

/**
 * LFPDPPP (DOF 20-03-2025) art. 31: the controller answers an ARCO request
 * within 20 días and makes it effective within 15 more. Art. 2 VIII defines
 * "días" as business days. Both periods may be extended once when justified.
 */
export const ARCO_RESPONSE_BUSINESS_DAYS = 20;
export const ARCO_EFFECTIVE_BUSINESS_DAYS = 15;

/**
 * Adds business days, skipping Saturdays and Sundays only. Mexican public
 * holidays are NOT skipped, so the result is an approximate (conservative)
 * deadline and is labelled as such in the UI.
 */
export const addBusinessDays = (start: Date, days: number): Date => {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return result;
};
