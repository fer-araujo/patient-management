import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CircleXIcon } from "lucide-react";

const ExpiredPage = () => {
  return (
    <div className="flex h-screen max-h-screen px-[5%]">
      <div className="success-img">
        <Link href="/">
          <Image
            src="/assets/icons/logo-full.svg"
            height={150}
            width={150}
            alt="logo"
          />
        </Link>

        <section className="flex flex-col items-center mt-10 gap-10">
          <CircleXIcon className="h-16 w-16 text-red-500" />
          <h2 className="header mb-6 max-w-[600px] text-center">
            Lo sentimos, esta <span className="text-red-500">página</span> ya no está disponible
          </h2>
          <p className="text-xl text-center font-medium text-dark-600">
            La sesión de confirmación expiró por seguridad. Por favor, agenda tu cita nuevamente.
          </p>
        </section>

        <div className="mt-8 flex justify-center">
          <Button variant="outline" className="shad-primary-btn" asChild>
            <Link href="/">Agendar nueva cita</Link>
          </Button>
        </div>

        <p className="copyright mt-4">© 2025 Cuidado Médico</p>
      </div>
    </div>
  );
};

export default ExpiredPage;
