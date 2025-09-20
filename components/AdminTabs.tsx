"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StatCard from "@/components/StatCard";
import { DataTable } from "@/components/table/DataTable";
import { columns } from "@/components/table/columns";
import { patientColumns } from "@/components/table/patientColumns";
import { Appointment, Patient } from "@/types/appwrite.types";

interface AdminTabsProps {
  appointments: {
    scheduledCount: number;
    pendingCount: number;
    cancelledCount: number;
    documents: Appointment[];
  };
  patients: Patient[];
}

const AdminTabs = ({ appointments, patients }: AdminTabsProps) => {
  const totalPatients = patients.length;
  const newPatients = patients.filter(p => new Date(p.$createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length;
  const activePatients = patients.filter(p => p.studyFiles && p.studyFiles.length > 0).length;

  return (
    <Tabs defaultValue="citas" className="w-full">
      <TabsList className="h-14 bg-dark-200 rounded-lg p-1 w-full">
        <TabsTrigger value="citas" className="h-12 px-8 text-lg font-light flex-1 hover:bg-dark-300 hover:cursor-pointer data-[state=active]:bg-dark-500">Citas</TabsTrigger>
        <TabsTrigger value="pacientes" className="h-12 px-8 text-lg font-light flex-1 hover:bg-dark-300 hover:cursor-pointer data-[state=active]:bg-dark-500">Pacientes</TabsTrigger>
      </TabsList>
      <TabsContent value="citas">
        <section className="admin-stat mt-5">
          <StatCard
            type="appointments"
            count={appointments?.scheduledCount}
            label="Citas Agendadas"
            icon="/assets/icons/appointments.svg"
          />
          <StatCard
            type="pending"
            count={appointments?.pendingCount}
            label="Citas Pendientes"
            icon="/assets/icons/pending.svg"
          />
          <StatCard
            type="cancelled"
            count={appointments?.cancelledCount}
            label="Citas Canceladas o Rechazadas"
            icon="/assets/icons/cancelled.svg"
          />
        </section>

        <div className="mt-15">
          <DataTable columns={columns} data={appointments?.documents} />
        </div>
      </TabsContent>
      <TabsContent value="pacientes">
        <section className="admin-stat mt-5">
          <StatCard
            type="appointments"
            count={totalPatients}
            label="Pacientes Totales"
            icon="/assets/icons/appointments.svg"
          />
          <StatCard
            type="pending"
            count={newPatients}
            label="Pacientes Nuevos"
            icon="/assets/icons/pending.svg"
          />
          <StatCard
            type="cancelled"
            count={activePatients}
            label="Pacientes Activos"
            icon="/assets/icons/cancelled.svg"
          />
        </section>

        <div className="mt-15">
          <DataTable columns={patientColumns} data={patients} />
        </div>
      </TabsContent>
    </Tabs>
  );
};

export default AdminTabs;