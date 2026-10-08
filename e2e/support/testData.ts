/**
 * Unique test data. Everything the suite creates starts with "E2E-" and a
 * timestamp, so runs (and projects) never collide and the records are easy to
 * recognise; the pre-production reset removes them (see e2e/README.md).
 */

export interface TestPatient {
  firstName: string;
  lastName: string;
  /** firstName + " " + lastName, as the calendar and the directory show it. */
  fullName: string;
  /** Starts with 00, so it can never be a real number that gets a WhatsApp. */
  phone: string;
}

export const e2eStamp = (): string =>
  `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

export const newTestPatient = (projectName: string): TestPatient => {
  const stamp = e2eStamp();
  const firstName = `E2E-${stamp}`;
  const lastName = `Paciente ${projectName}`;
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    phone: `00${stamp.slice(-8)}`,
  };
};

export const e2eName = (kind: string): string => `E2E-${kind}-${e2eStamp()}`;
