"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
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
import { registerApointment } from "@/lib/actions/appointment.actions";
import { setCookie } from "cookies-next";
import { v4 as uuidv4 } from "uuid";

export const AppointmentForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showFullForm, setShowFullForm] = useState(false);
  const [patientFound, setPatientFound] = useState(false);

  const router = useRouter();

  const form = useForm<z.infer<typeof CreateAppointmentSchema>>({
    resolver: zodResolver(CreateAppointmentSchema),
    defaultValues: {
      name: "",
      phone: "",
      reason: "",
      studyDocument: [],
      schedule: new Date(),
    },
  });

  const onSubmit = async (values: z.infer<typeof CreateAppointmentSchema>) => {
    setIsLoading(true);

    const formData = new FormData();
    if (values.studyDocument && values.studyDocument.length > 0) {
      values.studyDocument.forEach((file) => {
        const blobFile = new Blob([file], { type: file.type });
        formData.append("blobFile", blobFile);
        formData.append("fileName", file.name);
      });
    }

    try {
      const confirmationToken = uuidv4();
      setCookie("appointmentToken", confirmationToken, { maxAge: 300, path: "/" });

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

      const appointment = await registerApointment(appointmentData);

      console.log(appointment);
      form.reset();
      router.push(`/appointments/success/${appointment?.$id}`);
    } catch (error) {
      console.error(error);
    }

    setIsLoading(false);
  };

  const handlePatientFound = (patient: { name: string }) => {
    form.setValue("name", patient.name);
    setPatientFound(true);
  };

  return (
    <Form {...form}>
      <motion.form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex-1 space-y-10"
      >
        <AnimatePresence mode="wait">
          {!showFullForm && (
            <motion.div
              key="search-only"
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 60 }}
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

          {showFullForm && (
            <motion.div
              key="form-section"
              initial={{ opacity: 0, x: -60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-dark-700">
                ¡Vamos a completar tu cita!
              </h2>

              {/* Volvemos a renderizar el campo de teléfono pero como parte del form */}
              <CustomFormField
                fieldType={FormFieldType.PHONE_INPUT}
                control={form.control}
                name="phone"
                label="Número de teléfono"
                placeholder="(52) 123-4567"
              />

              <CustomFormField
                fieldType={FormFieldType.INPUT}
                control={form.control}
                name="name"
                label="Nombre"
                placeholder="Escribe tu nombre completo aquí"
                iconSrc="/assets/icons/user.svg"
                disabled={patientFound} // Deshabilitamos el campo si el paciente fue encontrado
              />

              <div className="flex flex-col gap-6 xl:flex-row">
                <CustomFormField
                  fieldType={FormFieldType.TEXTAREA}
                  control={form.control}
                  name="reason"
                  label="Razón de la cita"
                  placeholder="Detalles aquí..."
                />

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
              </div>

              <CustomFormField
                fieldType={FormFieldType.DATE_PICKER}
                control={form.control}
                name="schedule"
                label="Seleccionar Fecha y Hora"
                showTimeSelect
                dateFormat="MM/dd/yyyy  -  h:mm aa"
              />

              <SubmitButton isLoading={isLoading}>Agendar</SubmitButton>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>
    </Form>
  );
};
