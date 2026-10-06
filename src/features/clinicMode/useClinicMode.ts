import { useContext } from "react";
import { ClinicModeContext } from "./clinicModeContext";

/** The clinic's doctor-only mode, read once per page load by ClinicModeProvider. */
export const useClinicMode = () => useContext(ClinicModeContext);
