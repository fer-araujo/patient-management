"use client";

import { useState } from "react";
import { Control, FieldValues, Path, useFormContext, useWatch } from "react-hook-form";
import CustomFormField, { FormFieldType } from "./CustomFormField";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPatientByPhone } from "@/lib/actions/patient.actions";
import Spinner from "./Spinner";
import { motion, AnimatePresence } from "framer-motion";

interface PhoneSearchFieldProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  onPatientFound: (patient: { name: string }) => void;
  onPatientStatus: (found: boolean) => void;
}

export function PhoneSearchField<T extends Record<string, unknown>>({
  name,
  control,
  onPatientFound,
  onPatientStatus,
}: PhoneSearchFieldProps<T>) {
  const { setValue } = useFormContext<T>();
  const phoneValue = useWatch({ control, name });

  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPatient = async () => {
    if (!phoneValue || hasSearched) return;
    setLoading(true);

    try {
      const patient = await getPatientByPhone(phoneValue as string);
      if (patient) {
        onPatientFound({ name: patient.name });
        setValue("phone" as Path<T>, phoneValue);
        onPatientStatus(true);
      } else {
        onPatientStatus(false);
      }
    } catch (error) {
      console.error("Error fetching patient:", error);
      onPatientStatus(false);
    }

    setLoading(false);
    setTimeout(() => setHasSearched(true), 500);
  };

  return (
    <AnimatePresence>
      {!hasSearched && (
        <motion.div
          key="phone-search"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          transition={{ duration: 0.25 }}
          className="flex gap-2 items-end"
        >
          {loading ? (
            <Skeleton className="input-phone w-full h-[44px] rounded-md border-none" />
          ) : (
            <CustomFormField
              fieldType={FormFieldType.PHONE_INPUT}
              control={control}
              name={name}
              label="Número de teléfono"
              placeholder="(52) 123-4567"
            />
          )}
          <Button
            type="button"
            onClick={fetchPatient}
            className="shad-gray-btn h-11 w-[100px]"
            disabled={loading}
          >
            {loading ? <Spinner size="sm" /> : "Buscar"}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
