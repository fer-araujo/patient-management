import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Users, Search, Ban, UserCheck, ShieldAlert } from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import { MOCK_APPOINTMENTS } from "../../../../data/mockPatients";
import { Modal } from "../../../../components/ui/Modal";

// 1. LA INTERFAZ ESTRICTA (Adiós "any")
interface DerivedPatient {
  id: string;
  name: string;
  phone: string;
  totalVisits: number;
  lastVisit: string;
  status: "active" | "blocked";
}

// 2. INFERIMOS LOS PACIENTES Y TIPAMOS EL RETORNO
const getDerivedPatients = (): DerivedPatient[] => {
  const patientMap = new Map<string, DerivedPatient>();

  MOCK_APPOINTMENTS.forEach((app) => {
    if (!patientMap.has(app.patientName)) {
      patientMap.set(app.patientName, {
        id: `pat_${app.id}`,
        name: app.patientName,
        phone: app.phone,
        totalVisits: 0,
        lastVisit: app.date,
        status: "active",
      });
    }

    if (app.status === "completed") {
      const p = patientMap.get(app.patientName)!;
      p.totalVisits += 1;
    }
  });

  return Array.from(patientMap.values());
};

export const PatientsTab = () => {
  const initialPatients = useMemo(() => getDerivedPatients(), []);
  const [patients, setPatients] = useState<DerivedPatient[]>(initialPatients);
  const [searchTerm, setSearchTerm] = useState("");

  // Tipado correcto para el modal
  const [patientToBlock, setPatientToBlock] = useState<DerivedPatient | null>(
    null,
  );

  const filteredData = useMemo(() => {
    return patients.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [patients, searchTerm]);

  const handleToggleBlock = (patientId: string) => {
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id === patientId) {
          return { ...p, status: p.status === "active" ? "blocked" : "active" };
        }
        return p;
      }),
    );
    setPatientToBlock(null);
  };

  // Tipado correcto en las columnas
  const columns: ColumnDef<DerivedPatient>[] = [
    {
      header: "Paciente",
      accessorKey: "name",
      sortable: true,
      className: "w-[30%]",
      cell: (row) => (
        <div className="flex flex-col">
          <span
            className={`font-bold text-base ${row.status === "blocked" ? "text-slate-400 line-through" : "text-brand-dark"}`}
          >
            {row.name}
          </span>
          {row.status === "blocked" && (
            <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md mt-1 w-fit uppercase tracking-wider flex items-center gap-1">
              <Ban className="w-3 h-3" /> Bloqueado
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Teléfono",
      accessorKey: "phone",
      className: "w-[20%] text-brand-gray font-medium",
    },
    {
      header: "Última Cita Registrada",
      accessorKey: "lastVisit",
      sortable: true,
      className: "w-[20%] text-sm font-medium text-brand-dark",
    },
    {
      header: "Consultas Completadas",
      accessorKey: "totalVisits",
      sortable: true,
      className: "w-[15%] text-center font-bold text-brand-primary",
    },
    {
      header: "Gestión",
      className: "w-[15%] text-right",
      cell: (row) => (
        <div className="flex justify-end">
          {row.status === "active" ? (
            <Button
              variant="outline"
              onClick={() => setPatientToBlock(row)}
              className="px-3 py-1.5 rounded-lg border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Ban className="w-3.5 h-3.5" /> Suspender
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleToggleBlock(row.id)}
              className="px-3 py-1.5 rounded-lg border-teal-200 text-teal-600 hover:bg-teal-50 hover:border-teal-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5" /> Readmitir
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* KPIs DE PACIENTES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Total Expedientes
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {patients.length}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <Ban className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Pacientes Bloqueados
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {patients.filter((p) => p.status === "blocked").length}
            </h4>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="relative w-full sm:w-96">
          <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar expediente por nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-sm rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <DataGrid
          data={filteredData}
          columns={columns}
          keyExtractor={(row) => row.id}
          itemsPerPage={10}
        />
      </div>

      {/* MODAL DE BLOQUEO DE PACIENTE */}
      <Modal
        isOpen={!!patientToBlock}
        onClose={() => setPatientToBlock(null)}
        title="Suspender Paciente"
        icon={<ShieldAlert className="w-5 h-5 text-rose-500" />}
        hideFooter={true}
      >
        {patientToBlock && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-2 text-rose-500">
              <Ban className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-brand-dark">
              ¿Suspender a {patientToBlock.name}?
            </h3>
            <p className="text-brand-gray">
              El paciente no podrá agendar nuevas citas ni desde su app ni desde
              el portal público. Podrás revertir esto más adelante.
            </p>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setPatientToBlock(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleToggleBlock(patientToBlock.id)}
                className="flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white cursor-pointer border-none shadow-md"
              >
                Sí, Suspender
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
