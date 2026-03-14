import { motion } from "framer-motion";
import {
  Users,
  UserPlus,
  HeartPulse,
  Search,
} from "lucide-react";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";

const MOCK_PATIENTS = [
  {
    id: "p1",
    name: "María López",
    email: "maria@example.com",
    phone: "55 1234 5678",
    lastVisit: "10 Mar 2026",
    totalVisits: 4,
  },
  {
    id: "p2",
    name: "Ana Sofía Ruiz",
    email: "ana@example.com",
    phone: "55 8765 4321",
    lastVisit: "-",
    totalVisits: 0,
  },
];

export const PatientsTab = () => {
  const columns: ColumnDef<(typeof MOCK_PATIENTS)[0]>[] = [
    {
      header: "Paciente",
      accessorKey: "name",
      sortable: true,
      className: "w-[30%] font-bold text-brand-dark",
    },
    {
      header: "Contacto",
      className: "w-[30%]",
      cell: (row) => (
        <div className="text-sm text-brand-gray">
          {row.email}
          <br />
          {row.phone}
        </div>
      ),
    },
    {
      header: "Última Visita",
      accessorKey: "lastVisit",
      sortable: true,
      className: "w-[20%] text-sm font-medium",
    },
    {
      header: "Total Consultas",
      accessorKey: "totalVisits",
      sortable: true,
      className: "w-[20%] text-center font-bold",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Pacientes Activos
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              245
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center shrink-0">
            <UserPlus className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Nuevos este mes
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              18
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-teal-50 text-teal-500 rounded-2xl flex items-center justify-center shrink-0">
            <HeartPulse className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Tasa de Retorno
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              82%
            </h4>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-5 h-5 text-brand-gray absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nombre o correo..."
              className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 shadow-sm rounded-2xl text-sm font-medium focus:outline-none focus:border-brand-primary w-full sm:w-80"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <DataGrid
          data={MOCK_PATIENTS}
          columns={columns}
          keyExtractor={(row) => row.id}
          itemsPerPage={10}
        />
      </div>
    </motion.div>
  );
};
