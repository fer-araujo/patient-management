// app/appointments/[appointmentId]/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getAppointmentById, updateAppointment } from "@/lib/actions/appointment.actions";
import { Appointment } from "@/types/appwrite.types";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import CustomFormField, { FormFieldType } from "@/components/CustomFormField";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const RescheduleView = () => {
  const router = useRouter();
  const { appointmentId } = useParams();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'view'|'propose'>('view');

  const form = useForm<{
    schedule: Date;
  }>({
    resolver: zodResolver(z.object({ schedule: z.date() })),
  });

  useEffect(() => {
    async function load() {
      if (!appointmentId) return;
      const data = await getAppointmentById(appointmentId);
      setAppointment(data);
      setLoading(false);
    }
    load();
  }, [appointmentId]);

  if (loading) return <p>Cargando...</p>;
  if (!appointment) return <p>Cita no encontrada.</p>;

  const onAccept = async () => {
    await updateAppointment({ appointmentId, status: 'scheduled' });
    router.push('/');
  };

  const onReject = async () => {
    await updateAppointment({ appointmentId, status: 'denied' });
    router.push('/');
  };

  const onSubmit = async (values: any) => {
    await updateAppointment({ appointmentId, status: 'rescheduled', schedule: values.schedule.toISOString() });
    router.push('/');
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Reagendar Cita</h1>
      {mode === 'view' && (
        <div className="space-y-4">
          <p>Tu cita fue reagendada a:</p>
          <p className="font-bold">
            {formatDateTime(appointment.schedule).dateTime}
          </p>
          <div className="flex gap-4">
            <Button onClick={onAccept}>Aceptar</Button>
            <Button variant="outline" onClick={onReject}>Rechazar</Button>
            <Button variant="secondary" onClick={() => setMode('propose')}>Proponer otra fecha</Button>
          </div>
        </div>
      )}

      {mode === 'propose' && (
        <div className="space-y-4">
          <h2 className="text-xl font-medium">Proponer nueva fecha</h2>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <CustomFormField
              fieldType={FormFieldType.DATE_PICKER}
              control={form.control}
              name="schedule"
              label="Fecha y hora"
              showTimeSelect
              dateFormat="dd/MM/yyyy - h:mm aa"
            />
            <div className="flex gap-4">
              <Button type="submit">Enviar</Button>
              <Button variant="ghost" onClick={() => setMode('view')}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default RescheduleView;
