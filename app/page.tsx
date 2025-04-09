"use client";

import { useEffect, useState } from "react";
import { AppointmentForm } from "@/components/forms/AppointmentForm";
import Image from "next/image";
import { motion } from "framer-motion";
import Spinner from "@/components/Spinner";
import Link from "next/link";

const Appointment = () => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 1200);
    return () => clearTimeout(timeout);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-dark-300">
        <Spinner text />
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-screen max-h-screen overflow-y-auto">
      <section className="flex min-h-screen w-full flex-1 items-center justify-center container remove-scrollbar lg:w-1/2">
        <div className="mt-[-100] auto max-w-[860px] flex-1 justify-between">
          <Image
            src="/assets/icons/logo-full.svg"
            height={1000}
            width={1000}
            alt="logo"
            className=" mb-10 w-auto h-30 lg:h-40"
          />

          <AppointmentForm />

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
