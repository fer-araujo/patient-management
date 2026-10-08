import { useCallback, useRef, useState } from "react";
import {
  fetchPatients,
  type DashboardPatient,
} from "../../../lib/services/patientService";
import {
  fetchActiveServices,
  type ClinicService,
} from "../../../lib/services/catalogService";

export interface BookingOption {
  label: string;
  value: string;
}

/** A service the doctor can book: an active catalog entry, with its real length. */
export interface BookableService {
  id: string;
  name: string;
  durationMins: number;
}

export type BookingCatalogStatus = "idle" | "loading" | "ready" | "error";

export const BOOKING_CATALOG_ERROR =
  "No se pudo cargar la lista de pacientes y servicios.";

const normalizeName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

const phoneLast4 = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/**
 * Patients the doctor can book, sorted by name. Archived and anonymized
 * records are left out (the server refuses archived ones as well); suspended
 * ("blocked") patients stay: suspension only closes the public portal.
 * Patients sharing a name get the last 4 digits of their phone to tell them apart.
 */
export const toBookablePatientOptions = (
  patients: DashboardPatient[],
): BookingOption[] => {
  const bookable = patients
    .filter((p) => p.status !== "archived" && !p.anonymizedAt)
    .map((p) => ({ ...p, name: p.name.trim().replace(/\s+/g, " ") }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "es", { sensitivity: "base" }) ||
        a.id.localeCompare(b.id),
    );

  const nameCount = new Map<string, number>();
  for (const p of bookable) {
    const key = normalizeName(p.name);
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }

  return bookable.map((p) => {
    const last4 =
      (nameCount.get(normalizeName(p.name)) ?? 0) > 1 ? phoneLast4(p.phone) : null;
    return {
      value: p.id,
      label: last4 ? `${p.name} · tel. ${last4}` : p.name,
    };
  });
};

/** Only active services, by name, with the catalog's duration. */
export const toBookableServices = (services: ClinicService[]): BookableService[] =>
  services
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.name, durationMins: s.durationMins }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

/**
 * The real patient directory and the active catalog for "Agendar Cita".
 * `load` is called each time the modal opens (and by "Reintentar"), so a
 * patient or service created since the last booking is offered right away.
 * Never built from existing appointments: with none (e.g. right after the
 * pre-production reset) nothing could be booked.
 */
export const useBookingCatalog = () => {
  const [status, setStatus] = useState<BookingCatalogStatus>("idle");
  const [patientOptions, setPatientOptions] = useState<BookingOption[]>([]);
  const [services, setServices] = useState<BookableService[]>([]);
  // Only the latest request may update the state (reopen or retry while loading).
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setStatus("loading");
    Promise.all([fetchPatients(), fetchActiveServices()])
      .then(([patients, activeServices]) => {
        if (requestRef.current !== request) return;
        setPatientOptions(toBookablePatientOptions(patients));
        setServices(toBookableServices(activeServices));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        console.error(
          "Error al cargar pacientes y servicios para agendar:",
          err instanceof Error ? err.message : err,
        );
        if (requestRef.current !== request) return;
        setStatus("error");
      });
  }, []);

  return { status, patientOptions, services, load };
};
