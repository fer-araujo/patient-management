import { AppointmentForm } from "@/components/forms/AppointmentForm";
import Image from "next/image";

const Appointment = async () => {
  return (
    // Contenedor principal que permite scroll en toda la página si el contenido lo necesita
    <div className="flex flex-col lg:flex-row w-full min-h-screen overflow-y-auto">
      {/* Sección izquierda - Formulario */}
      <section className="w-full flex items-center justify-center px-4 lg:w-1/2">
        <div className="subcontainer max-w-[860px] w-full">
          {/* Logo actualizado */}
          <Image
            src="/assets/icons/logo-full.svg"
            alt="logo"
            width={180}
            height={80}
            priority
            className="w-auto h-30 lg:h-[18vh]"
          />

          {/* Formulario de citas */}
          <AppointmentForm />

          {/* Pie de página */}
          <p className="mt-2 py-5 text-center text-sm text-gray-400">
            © 2025 Cuidado Médico — {" "}
            <a href="/admin/login" className="text-green-500 hover:text-primary">
              Admin
            </a>
          </p>
        </div>
      </section>

      {/* Sección derecha - Imagen decorativa (visible solo en pantallas grandes) */}
      <div className="hidden lg:flex items-center justify-start max-h-full">
        <Image
          src="/assets/images/women-appointment-img.png"
          alt="appointment"
          width={1800}
          height={1800}
          priority
          className="w-[45vw] h-auto object-contain animate-calendar-pop ml-[-1vw]"
        />
      </div>
    </div>
  );
};

export default Appointment;
