/**
 * Phone handling shared by staff forms. Mirrors the patient login/booking flow
 * (PatientPhoneLogin): a country code (MX +52 or US +1) plus a 10-digit
 * national number, stored in E.164 as `countryCode + digits`
 * (e.g. "+525512345678").
 */

export const PHONE_COUNTRY_OPTIONS = [
  { label: "MX +52", value: "+52" },
  { label: "US +1", value: "+1" },
];

export const DEFAULT_COUNTRY_CODE = "+52";
export const NATIONAL_PHONE_LENGTH = 10;

const digitsOf = (value: string | null | undefined): string =>
  (value ?? "").replace(/\D/g, "");

/** E.164 phone from a country code and a 10-digit number, or null if invalid. */
export const toE164Phone = (
  countryCode: string,
  nationalNumber: string,
): string | null => {
  const digits = digitsOf(nationalNumber);
  const knownCountry = PHONE_COUNTRY_OPTIONS.some((o) => o.value === countryCode);
  if (!knownCountry || digits.length !== NATIONAL_PHONE_LENGTH) return null;
  return countryCode + digits;
};

/**
 * Splits a stored phone back into the form's two fields. Accepts E.164 with or
 * without the "+", the legacy MX mobile "+521..." form and a bare 10-digit
 * number (assumed Mexican). Anything else keeps its digits so the form shows
 * it and the 10-digit validation asks for a correction.
 */
export const splitStoredPhone = (
  phone: string | null | undefined,
): { countryCode: string; nationalNumber: string } => {
  const digits = digitsOf(phone);
  if (digits.length === 13 && digits.startsWith("521")) {
    return { countryCode: "+52", nationalNumber: digits.slice(3) };
  }
  if (digits.length === 12 && digits.startsWith("52")) {
    return { countryCode: "+52", nationalNumber: digits.slice(2) };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { countryCode: "+1", nationalNumber: digits.slice(1) };
  }
  return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: digits };
};

/** Normalizes any accepted input (see splitStoredPhone) to E.164, or null. */
export const normalizeToE164 = (phone: string | null | undefined): string | null => {
  const { countryCode, nationalNumber } = splitStoredPhone(phone);
  return toE164Phone(countryCode, nationalNumber);
};

/**
 * Digits-only canonical form, the same comparison the database uses
 * (public.normalize_phone): the legacy MX mobile "1" after 52 is dropped.
 */
export const canonicalPhone = (phone: string | null | undefined): string => {
  const digits = digitsOf(phone);
  return digits.length === 13 && digits.startsWith("521")
    ? `52${digits.slice(3)}`
    : digits;
};
