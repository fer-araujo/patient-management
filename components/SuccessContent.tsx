"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCookie } from "cookies-next";
import { formatDateTime } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { Button } from "./ui/button";
import { CheckCircle } from "lucide-react";
import Spinner from "./Spinner";
import { motion } from "framer-motion";

interface Appointment {
  confirmationToken: string;
  schedule: string;
}

const SuccessContent = ({ appointment }: { appointment: Appointment }) => {
  const router = useRouter();
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const hasValidated = useRef(false);

  useEffect(() => {
    if (hasValidated.current) return;

    const validateToken = () => {
      const rawCookie = document.cookie;
      const match = rawCookie.match(/appointmentToken=([^;]+)/);
      const tokenFromCookie = match?.[1];
      const tokenFromDb = appointment?.confirmationToken;

      const isTokenValid = tokenFromCookie === tokenFromDb;

      if (!isTokenValid) {
        router.replace("/appointments/expired");
      } else {
        setIsValid(true);
        deleteCookie("appointmentToken");
      }

      hasValidated.current = true;
    };

    validateToken();
  }, [appointment, router]);

  if (isValid === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner text />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="flex h-screen max-h-screen px-[5%]"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="success-img"
      >
        <Link href="/">
          <Image
            src="/assets/icons/logo-full.svg"
            height={150}
            width={150}
            alt="logo"
          />
        </Link>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.25 }}
          className="flex flex-col items-center mt-10 gap-10"
        >
          <CheckCircle className="h-16 w-16 text-green-500" />
          <h2 className="header mb-6 max-w-[600px] text-center">
            ¡Tu <span className="text-green-500">cita</span> ha sido registrada
            exitosamente!
          </h2>
          <p className="text-xl text-center font-medium">
            Nos comunicaremos pronto para corroborar su cita.
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5 }}
          className="request-details mt-6"
        >
          <p className="font-medium">Información de tu cita:</p>
          <div className="flex items-center gap-3">
            <p className="whitespace-nowrap font-medium text-dark-700">
              Dra. Ma. del Carmen Torres Morales
            </p>
          </div>
          <div className="flex gap-2 text-dark-700 mt-2">
            <Image
              src="/assets/icons/calendar.svg"
              height={24}
              width={24}
              alt="calendar"
            />
            <p>{formatDateTime(appointment.schedule).dateTime}</p>
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8 }}
          className="mt-8"
        >
          <Button variant="outline" className="shad-primary-btn" asChild>
            <Link href="/">Volver al inicio</Link>
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          className="copyright mt-4"
        >
          © 2025 Cuidado Médico
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

export default SuccessContent;
