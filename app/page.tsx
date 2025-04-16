"use client";

import { AppointmentForm } from "@/components/forms/AppointmentForm";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from "next/link";
import PassKeyModal from "@/components/PassKeyModal";
import { useSearchParams } from "next/navigation";

const Appointment = () => {
  const searchParams = useSearchParams();
  const isAdmin = searchParams.get("admin") === "true";

  return (
    <div className="flex h-screen min-h-screen max-h-screen ">
      {isAdmin && <PassKeyModal />}
      <section className="flex min-h-screen w-full flex-1 items-center justify-center container remove-scrollbar lg:w-1/2">
        <div className="mt-[-100] auto max-w-[860px] flex-1 justify-between">
          <Image
            src="/assets/icons/logo-full-optimized.svg"
            height={1000}
            width={1000}
            alt="logo"
            className=" mb-10 w-auto h-30 lg:h-40"
          />

          <AppointmentForm type="Crear"/>

          <div className="text-sm mt-30 flex gap-4">
            <p className="justify-items-end text-dark-600 xl:text-left">
              © 2025 Cuidado Médico
            </p>
            <Link href="/?admin=true" className="text-green-500">
              Admin
            </Link>
          </div>
        </div>
      </section>

      <motion.div
        initial={{ opacity: 0, x: 80 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex max-h-full lg:w-1/2 items-center justify-center"
      >
        <Image
          src="/assets/images/women-appointment-img.png"
          alt="appointment"
          width={800}
          height={800}
          priority
          className="object-contain"
        />
      </motion.div>
    </div>
  );
};

export default Appointment;
