const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whole years from a "YYYY-MM-DD" birth date, read as a local date (not UTC
 * midnight). Null when the date is missing, malformed or in the future.
 */
export const ageFromDob = (
  dob: string | null | undefined,
  today: Date = new Date(),
): number | null => {
  const m = dob ? DATE_ONLY.exec(dob) : null;
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(birth.getTime())) return null;

  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
};

/**
 * "68 años · Femenino" for the patient header (NOM-004 5.9). Missing data is
 * said plainly so the doctor notices it.
 */
export const describeAgeAndSex = (
  dob: string | null | undefined,
  sex: string | null | undefined,
  today: Date = new Date(),
): string => {
  const age = ageFromDob(dob, today);
  const ageText =
    age === null ? "Edad sin registrar" : `${age} ${age === 1 ? "año" : "años"}`;
  const sexText = sex?.trim() || "Sexo sin registrar";
  return `${ageText} · ${sexText}`;
};
