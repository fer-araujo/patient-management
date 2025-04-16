import React from "react";
import Link from "next/link";
import Image from "next/image";
import StatCard from "@/components/StatCard";
import { getRecentAppointmentList } from "@/lib/actions/appointment.actions";
import { DataTable } from "@/components/table/DataTable";
import { columns } from "@/components/table/columns";
 
const Admin = async () => {
  const appointments = await getRecentAppointmentList();

  return (
    <div className="mx-auto flex max-w-7xl flex-col space-y-14">
      <header className="admin-header">
        <Link href="/" className="cursor-pointer">
          <Image
            src="/assets/icons/logo-full-optimized.svg"
            height={20}
            width={100}
            alt="logo"
          />
        </Link>

        <p className="text-regular font-semibold">Administrador</p>
      </header>

      <main className="admin-main">
        <section className="w-full space-y-4">
          <h1 className="header"> Hola! 👋 </h1>
          <p className="text-dark-700">Administrador de citas</p>
        </section>
        <section className="admin-stat">
          <StatCard
            type="appointments"
            count={appointments.scheduledCount}
            label="Citas Agendadas"
            icon="/assets/icons/appointments.svg"
          />
          <StatCard
            type="pending"
            count={appointments.pendingCount}
            label="Citas Pendientes"
            icon="/assets/icons/pending.svg"
          />
          <StatCard
            type="cancelled"
            count={appointments.cancelledCount}
            label="Citas Canceladas"
            icon="/assets/icons/cancelled.svg"
          />
        </section>

        <DataTable columns={columns} data={appointments.documents} />

      </main>
    </div>
  );
};

export default Admin;
