"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormControl } from "@/components/ui/form";
import { CreateAppointmentSchema } from "@/lib/validation";
import CustomFormField, { FormFieldType } from "../CustomFormField";
import SubmitButton from "../SubmitButton";
import { FileUploader } from "../FileUploader";
import { useRouter } from "next/navigation";
import "react-phone-number-input/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneSearchField } from "../PhoneSearchField";
import { registerPatient } from "@/lib/actions/patient.actions";
import {
  registerAppointment,
  updateAppointment,
} from "@/lib/actions/appointment.actions";
import { setCookie } from "cookies-next";
import { v4 as uuidv4 } from "uuid";
import { Appointment } from "@/types/appwrite.types";
import { Status } from "@/types";

export const AppointmentForm = ({
  type,
  appointment,
  setOpen,
}: {
  type: "Crear" | "Agendar" | "Cancelar";
  appointment?: Appointment;
  setOpen?: (open: boolean) => void;
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showFullForm, setShowFullForm] = useState(false);
  const [patientFound, setPatientFound] = useState(false);

  const router = useRouter();
  const form = useForm<z.infer<typeof CreateAppointmentSchema>>({
    resolver: zodResolver(CreateAppointmentSchema),
    defaultValues: {
      name: appointment?.patientId.name || "",
      phone: appointment?.patientId.phone || "",
      reason: appointment?.reason || "",
      schedule: new Date(0),
      studyDocument: [],
      cancellationReason: "",
    },
  });

  useEffect(() => {
    if (appointment) {
      form.reset({
        name: appointment?.patientId.name || "",
        phone: appointment?.patientId.phone || "",
        reason: appointment.reason || "",
        schedule: appointment ? new Date(appointment.schedule) : new Date(),
        cancellationReason: "",
        studyDocument: [],
      });
    } else if (type === "Crear") {
      form.setValue("schedule", new Date()); // client-safe date
    }
  }, [appointment, type, form]);

  const onSubmit = async (values: z.infer<typeof CreateAppointmentSchema>) => {
    setIsLoading(true);
    let status;
    switch (type) {
      case "Agendar":
        status = "scheduled" as Status;
        break;
      case "Cancelar":
        status = "cancelled" as Status;
        break;
      default:
        status = "pending" as Status;
    }

    try {
      if (type === "Crear") {
        // Crear cita (tipo: "Crear")
        const confirmationToken = uuidv4();
        setCookie("appointmentToken", confirmationToken, {
          maxAge: 300,
          path: "/",
        });

        const formData = new FormData();
        if (values.studyDocument && values.studyDocument.length > 0) {
          values.studyDocument.forEach((file) => {
            const blobFile = new Blob([file], { type: file.type });
            formData.append("blobFile", blobFile);
            formData.append("fileName", file.name);
          });
        }

        const patientData = {
          name: values.name,
          phone: values.phone,
          studyDocument:
            (values.studyDocument ?? []).length > 0 ? formData : undefined,
        };

        const patient = await registerPatient(patientData);

        const appointmentData = {
          patientId: patient.$id,
          reason: values.reason,
          schedule: new Date(values.schedule).toISOString(),
          confirmationToken,
          status: "pending" as Status,
        };

        const appointmentRegistered = await registerAppointment(
          appointmentData
        );

        form.reset();
        router.push(`/appointments/success/${appointmentRegistered?.$id}`);
      } else {
        if (!appointment?.$id) {
          throw new Error(
            "Appointment ID is required for updating an appointment."
          );
        }

        const appointmentToUpdate = {
          appointmentId: appointment.$id,
          status,
          reason: values.reason,
          schedule: new Date(values.schedule).toISOString(),
          cancellationReason: values.cancellationReason || null,
          // type, se usara mas adelante.
        };
        const appointmentUpdated = await updateAppointment(appointmentToUpdate);

        if (appointmentUpdated) {
          setOpen?.(false);
          form.reset();
        }
      }
    } catch (error) {
      console.error(error);
    }
    setIsLoading(false);
  };

  const handlePatientFound = (patient: { name: string }) => {
    form.setValue("name", patient.name);
    setPatientFound(true);
  };

  let buttonLabel;
  switch (type) {
    case "Cancelar":
      buttonLabel = "Cancelar Cita";
      break;
    case "Agendar":
      buttonLabel = "Agendar Cita";
      break;
    default:
      buttonLabel = "Solicitar Cita";
  }

  const shouldShowForm = type !== "Crear" || showFullForm;

  return (
    <Form {...form}>
      <motion.form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex-1 space-y-10"
      >
        <AnimatePresence mode="wait">
          {type === "Crear" && !showFullForm && (
            <motion.div
              key="search-only"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              <h1 className="text-2xl font-semibold header">Hola! 👋</h1>
              <p className="text-xl text-dark-700">
                Agendemos tu cita, ingresa tu número
              </p>
              <PhoneSearchField
                name="phone"
                control={form.control}
                onPatientFound={handlePatientFound}
                onPatientStatus={() => {
                  setShowFullForm(true);
                }}
              />
            </motion.div>
          )}

          {shouldShowForm && (
            <motion.div
              key="form-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="space-y-6"
            >
              {type === "Crear" && (
                <h2 className="text-xl font-semibold text-dark-700">
                  ¡Vamos a completar tu cita!
                </h2>
              )}

              {/* Volvemos a renderizar el campo de teléfono pero como parte del form */}
              <CustomFormField
                fieldType={FormFieldType.PHONE_INPUT}
                control={form.control}
                name="phone"
                label="Número de teléfono"
                placeholder="(52) 123-4567"
                disabled={type === "Cancelar" || type === "Agendar"}
              />

              <CustomFormField
                fieldType={FormFieldType.INPUT}
                control={form.control}
                name="name"
                label="Nombre"
                placeholder="Escribe tu nombre completo aquí"
                iconSrc="/assets/icons/user.svg"
                disabled={
                  patientFound || type === "Cancelar" || type === "Agendar"
                }
              />

              {type !== "Cancelar" && (
                <div className="flex flex-col gap-6 xl:flex-row">
                  <CustomFormField
                    fieldType={FormFieldType.TEXTAREA}
                    control={form.control}
                    name="reason"
                    label="Razón de la cita"
                    placeholder="Detalles aquí..."
                    disabled={type === "Agendar"}
                  />
                  {type === "Crear" && (
                    <CustomFormField
                      fieldType={FormFieldType.SKELETON}
                      control={form.control}
                      name="studyDocument"
                      label="Estudio Médico"
                      renderSkeleton={(field) => (
                        <FormControl>
                          <FileUploader
                            files={(field as { value: File[] }).value}
                            onChange={
                              (
                                field as {
                                  onChange: (files: File[]) => void;
                                }
                              ).onChange
                            }
                          />
                        </FormControl>
                      )}
                    />
                  )}
                </div>
              )}

              <CustomFormField
                fieldType={FormFieldType.DATE_PICKER}
                control={form.control}
                name="schedule"
                label={
                  type === "Cancelar" || type === "Agendar"
                    ? "Fercha y Hora "
                    : "Seleccionar Fecha y Hora"
                }
                showTimeSelect
                dateFormat="dd/MM/yyyy  -  h:mm aa"
                disabled={type === "Cancelar" || type === "Agendar"}
              />

              {type === "Cancelar" && (
                <CustomFormField
                  fieldType={FormFieldType.TEXTAREA}
                  control={form.control}
                  name="cancellationReason"
                  label="Razon de cancelación"
                  placeholder="Algo urgente salio . . ."
                />
              )}
              <SubmitButton
                isLoading={isLoading}
                className={`${
                  type === "Cancelar" ? "shad-danger-btn" : "shad-primary-btn"
                } w-full`}
              >
                {buttonLabel}
              </SubmitButton>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>
    </Form>
  );
};
