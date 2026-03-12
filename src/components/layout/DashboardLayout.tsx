import type { ReactNode } from "react";
import { Header } from "./Header";

interface DashboardLayoutProps {
  children: ReactNode;
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-[#F8FDFD] font-sans antialiased selection:bg-brand-primary/20">
      <Header />
      {/* Contenedor principal donde vivirá el PatientDashboard u otras vistas */}
      <div className="pb-20">{children}</div>
    </div>
  );
};
