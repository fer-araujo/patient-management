import React from "react";
import Link from "next/link";
import Image from "next/image";
import { getRecentAppointmentList } from "@/lib/actions/appointment.actions";
import { getAllPatients } from "@/lib/actions/patient.actions";
import AuthRefresh from "@/components/AuthRefresh";
import { cookies } from 'next/headers';
import AdminTabs from "@/components/AdminTabs";

const Admin = async () => {
  const  JWT = process.env.NEXT_PUBLIC_COOKIE_JWT!;
  const cookieStore = cookies();
  const sessionJWT = (await cookieStore).get(JWT)?.value;
  if (!sessionJWT) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-regular font-semibold">No tienes acceso a esta página</p>
      </div>
    );
  }
  const appointments = await getRecentAppointmentList(sessionJWT);
  const patients = await getAllPatients(sessionJWT);

  return (
    <AuthRefresh>
      <div className="mx-auto flex min-w-[75vw] max-w-max flex-col space-y-14">
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

          <AdminTabs appointments={appointments} patients={patients} />
        </main>
      </div>
    </AuthRefresh>
  );
};

export default Admin;
