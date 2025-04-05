"use client";

import { zodResolver } from "@hookform/resolvers/zod";
// import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Form, FormControl } from "@/components/ui/form";
// import { createUser } from "@/lib/actions/patient.actions";
import { CreateAppointmentSchema } from "@/lib/validation";

import "react-phone-number-input/style.css";
import CustomFormField, { FormFieldType } from "../CustomFormField";
import SubmitButton from "../SubmitButton";
import { FileUploader } from "../FileUploader";

export const AppointmentForm = () => {
  // const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

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

    let formData;
    if (values.studyDocument && values.studyDocument?.length > 0) {
      const blobFile = new Blob([values.studyDocument[0]], {
        type: values.studyDocument[0].type,
      });

      formData = new FormData();
      formData.append("blobFile", blobFile);
      formData.append("fileName", values.studyDocument[0].name);
    }

    try {
      const patient = {
        name: values.name,
        phone: values.phone,
        studyUrl: values.studyDocument ? formData : undefined,
      };
      console.log(patient);
    } catch (error) {
      console.log(error);
    }

    setIsLoading(false);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex-1 space-y-10"
      >
        <section className=" space-y-4">
          <h1 className="text-2xl font-semibold header">Hola! 👋</h1>
          <p className="text-xl text-dark-700">Agendemos tu cita!</p>
        </section>

        <CustomFormField
          fieldType={FormFieldType.INPUT}
          control={form.control}
          name="name"
          label="Nombre"
          placeholder="Escribe tu nombre completo aquí"
          iconSrc="/assets/icons/user.svg"
          iconAlt="user"
        />

        <CustomFormField
          fieldType={FormFieldType.PHONE_INPUT}
          control={form.control}
          name="phone"
          label="Numero de telefono"
          placeholder="(52) 123-4567"
        />
        <div className="flex flex-col gap-6 xl:flex-row">
          <CustomFormField
            fieldType={FormFieldType.TEXTAREA}
            control={form.control}
            name="reason"
            label="Razon de la cita"
            placeholder="Details here ..."
          />

          <CustomFormField
            fieldType={FormFieldType.SKELETON}
            control={form.control}
            name="studyDocument"
            label="Estudio Medico"
            renderSkeleton={(field) => (
              <FormControl>
                <FileUploader
                  files={(field as { value: File[] }).value}
                  onChange={
                    (field as { onChange: (files: File[]) => void }).onChange
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
      </form>
    </Form>
  );
};
