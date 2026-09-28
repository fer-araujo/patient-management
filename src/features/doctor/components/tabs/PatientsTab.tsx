import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Search,
  Ban,
  UserCheck,
  ShieldAlert,
  Archive,
  FileText,
  UserPlus,
  UserPen,
  Calendar as CalendarIcon,
} from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import { Modal } from "../../../../components/ui/Modal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import {
  fetchPatients,
  updatePatientStatus,
  createPatient,
  PATIENT_GENDERS,
  type DashboardPatient,
} from "../../../../lib/services/patientService";
import { ConsultationWorkspace } from "../ConsultationWorkspace";
import { EditPatientModal } from "../modals/EditPatientModal";
import { toast } from "react-hot-toast/headless";

const GENDER_OPTIONS = [
  { label: "Sin especificar", value: "" },
  ...PATIENT_GENDERS.map((g) => ({ label: g, value: g })),
];

const todayIso = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** "12 de marzo de 1955", built as a local date (not UTC midnight). */
const formatBirthDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

export const PatientsTab = () => {
  const [patients, setPatients] = useState<DashboardPatient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<"active" | "blocked" | "archived">(
    "active",
  );
  const [searchTerm, setSearchTerm] = useState("");

  const [patientToBlock, setPatientToBlock] = useState<DashboardPatient | null>(
    null,
  );
  const [patientToArchive, setPatientToArchive] =
    useState<DashboardPatient | null>(null);
  const [selectedPatientProfile, setSelectedPatientProfile] =
    useState<DashboardPatient | null>(null);
  const [patientToEditId, setPatientToEditId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [isNewDobPickerOpen, setIsNewDobPickerOpen] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    dob: "",
    gender: "",
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPatients();
      setPatients(data);
    } catch (err: unknown) {
      console.error(
        "Error al cargar pacientes:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredData = useMemo(() => {
    return patients.filter(
      (p) =>
        p.status === activeTab &&
        p.name.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [patients, searchTerm, activeTab]);

  const stats = useMemo(
    () => ({
      active: patients.filter((p) => p.status === "active").length,
      blocked: patients.filter((p) => p.status === "blocked").length,
      archived: patients.filter((p) => p.status === "archived").length,
    }),
    [patients],
  );

  const handleChangeStatus = async (
    id: string,
    newStatus: "active" | "blocked" | "archived",
  ) => {
    try {
      setIsSubmitting(true);
      await updatePatientStatus(id, newStatus);
      await loadData();
      setPatientToBlock(null);
      setPatientToArchive(null);
    } catch (err: unknown) {
      console.error(
        "Error al cambiar estatus:",
        err instanceof Error ? err.message : err,
      );
      // The service throws Spanish messages (the database's reason for P0001).
      toast.error(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al cambiar el estatus del paciente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientForm.firstName || !newPatientForm.lastName) return;
    try {
      setIsSubmitting(true);
      await createPatient(
        newPatientForm.firstName,
        newPatientForm.lastName,
        newPatientForm.phone,
        newPatientForm.email,
        newPatientForm.dob,
        newPatientForm.gender,
      );
      await loadData();
      setIsNewPatientModalOpen(false);
      setNewPatientForm({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        dob: "",
        gender: "",
      });
    } catch (err: unknown) {
      console.error(
        "Error al crear paciente:",
        err instanceof Error ? err.message : err,
      );
      toast.error("No se pudo crear el paciente. Intenta nuevamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns: ColumnDef<DashboardPatient>[] = [
    {
      header: "Paciente",
      accessorKey: "name",
      sortable: true,
      className: "w-[30%]",
      cell: (row) => (
        <span
          className={`font-bold text-base ${row.status === "archived" ? "text-slate-400" : "text-brand-dark"}`}
        >
          {row.name}
        </span>
      ),
    },
    {
      header: "Teléfono",
      accessorKey: "phone",
      className: "w-[15%] text-sm font-medium text-brand-gray",
    },
    {
      header: "Última Cita",
      accessorKey: "lastVisit",
      sortable: true,
      className: "w-[20%] text-sm font-medium text-brand-dark",
      cell: (row) =>
        row.lastVisit || (
          <span className="text-slate-400 italic">Sin visitas previas</span>
        ),
    },
    {
      header: "Visitas",
      accessorKey: "totalVisits",
      sortable: true,
      className: "w-[10%] font-bold text-brand-primary",
    },
    {
      header: "Gestión",
      className: "w-[25%] text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <button type="button"
            onClick={() => setSelectedPatientProfile(row)}
            className="flex items-center justify-center w-10 h-10 bg-brand-light/20 text-brand-primary hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-brand-primary/20 hover:border-brand-primary shadow-sm cursor-pointer shrink-0"
            title="Ver Expediente"
          >
            <FileText className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <button type="button"
            onClick={() => setPatientToEditId(row.id)}
            className="flex items-center justify-center w-10 h-10 bg-brand-light/20 text-brand-primary hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-brand-primary/20 hover:border-brand-primary shadow-sm cursor-pointer shrink-0"
            title="Editar datos"
          >
            <UserPen className="w-5 h-5" strokeWidth={2.5} />
          </button>
          {row.status === "active" && (
            <>
              <button type="button"
                onClick={() => setPatientToBlock(row)}
                className="flex items-center justify-center w-10 h-10 bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white rounded-xl transition-all border border-amber-100 hover:border-amber-500 shadow-sm cursor-pointer shrink-0"
                title="Suspender Paciente"
              >
                <Ban className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <button type="button"
                onClick={() => setPatientToArchive(row)}
                className="flex items-center justify-center w-10 h-10 bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white rounded-xl transition-all border border-rose-100 hover:border-rose-500 shadow-sm cursor-pointer shrink-0"
                title="Archivar Expediente"
              >
                <Archive className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </>
          )}
          {/* An anonymized record stays archived for good (the database
              refuses it too), so it has no restore action. */}
          {(row.status === "blocked" || row.status === "archived") &&
            !row.anonymizedAt && (
              <button type="button"
                onClick={() => handleChangeStatus(row.id, "active")}
                className="flex items-center justify-center w-10 h-10 bg-teal-50 text-teal-600 hover:bg-teal-500 hover:text-white rounded-xl transition-all border border-teal-100 hover:border-teal-500 shadow-sm cursor-pointer shrink-0"
                title="Restaurar Paciente"
              >
                <UserCheck className="w-5 h-5" strokeWidth={2.5} />
              </button>
            )}
        </div>
      ),
    },
  ];

  // FIX: Sincronización al cerrar el Workspace
  if (selectedPatientProfile) {
    return (
      <ConsultationWorkspace
        // One mount per patient: no state leaks between records.
        key={selectedPatientProfile.id}
        patient={selectedPatientProfile}
        onClose={() => {
          setSelectedPatientProfile(null);
          loadData(); // ¡Obligamos a la tabla a refrescar el Post-it y los contadores!
        }}
      />
    );
  }

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
              {stats.active}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Ban className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Suspendidos
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.blocked}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <Archive className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Archivados (Inactivos)
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.archived}
            </h4>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-2">
        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full lg:w-auto">
          <button type="button"
            onClick={() => setActiveTab("active")}
            className={`cursor-pointer flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "active" ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
          >
            Activos
          </button>
          <button type="button"
            onClick={() => setActiveTab("blocked")}
            className={`cursor-pointer flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "blocked" ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
          >
            Suspendidos
          </button>
          <button type="button"
            onClick={() => setActiveTab("archived")}
            className={`cursor-pointer flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "archived" ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
          >
            Archivados
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar expediente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-[0_2px_10px_rgb(0,0,0,0.02)] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
            />
          </div>
          <Button type="button"
            onClick={() => setIsNewPatientModalOpen(true)}
            className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white font-bold shadow-md cursor-pointer border-none"
          >
            + Nuevo Paciente
          </Button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-400 font-bold">
            Cargando expedientes...
          </div>
        ) : (
          <DataGrid
            data={filteredData}
            columns={columns}
            keyExtractor={(row) => row.id}
            itemsPerPage={10}
          />
        )}
      </div>

      <Modal
        isOpen={isNewPatientModalOpen}
        onClose={() => setIsNewPatientModalOpen(false)}
        title="Nuevo Paciente"
        icon={<UserPlus className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <form onSubmit={handleCreatePatient} className="space-y-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-brand-dark">
                Nombre(s) <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={newPatientForm.firstName}
                onChange={(e) =>
                  setNewPatientForm({
                    ...newPatientForm,
                    firstName: e.target.value,
                  })
                }
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-primary text-sm"
                placeholder="Ej. María"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-brand-dark">
                Apellidos <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={newPatientForm.lastName}
                onChange={(e) =>
                  setNewPatientForm({
                    ...newPatientForm,
                    lastName: e.target.value,
                  })
                }
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-primary text-sm"
                placeholder="Ej. González"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-brand-dark">
                Teléfono
              </label>
              <input
                type="tel"
                value={newPatientForm.phone}
                onChange={(e) =>
                  setNewPatientForm({
                    ...newPatientForm,
                    phone: e.target.value,
                  })
                }
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-primary text-sm"
                placeholder="10 dígitos"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-brand-dark">
                Email{" "}
                <span className="text-brand-gray font-normal text-xs">
                  (Opcional)
                </span>
              </label>
              <input
                type="email"
                value={newPatientForm.email}
                onChange={(e) =>
                  setNewPatientForm({
                    ...newPatientForm,
                    email: e.target.value,
                  })
                }
                className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-primary text-sm"
                placeholder="correo@ejemplo.com"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Same DatePicker trigger as the patient edit modal, opened on
                past years since this is a birth date. */}
            <div className="w-full relative">
              <label
                htmlFor="new-patient-dob"
                className="text-brand-dark font-bold text-sm mb-2 block"
              >
                Fecha de nacimiento
              </label>
              <button
                id="new-patient-dob"
                type="button"
                onClick={() => setIsNewDobPickerOpen(true)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
              >
                <span
                  className={
                    newPatientForm.dob ? "text-brand-dark" : "text-brand-gray"
                  }
                >
                  {newPatientForm.dob
                    ? formatBirthDate(newPatientForm.dob)
                    : "Seleccionar..."}
                </span>
                <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
              </button>
              <div className="absolute top-full mt-2 z-50">
                <DatePicker
                  isOpen={isNewDobPickerOpen}
                  onClose={() => setIsNewDobPickerOpen(false)}
                  selectedDate={newPatientForm.dob || null}
                  maxDate={todayIso()}
                  allowPast
                  title="Fecha de nacimiento"
                  onSelectDate={(d) => {
                    setNewPatientForm({ ...newPatientForm, dob: d });
                    setIsNewDobPickerOpen(false);
                  }}
                />
              </div>
            </div>
            <div className="w-full">
              <label
                id="new-patient-gender-label"
                className="text-brand-dark font-bold text-sm mb-2 block"
              >
                Género
              </label>
              <Dropdown
                options={GENDER_OPTIONS}
                value={newPatientForm.gender}
                onChange={(val) =>
                  setNewPatientForm({ ...newPatientForm, gender: val })
                }
                labelledBy="new-patient-gender-label"
                className="py-0! text-sm!"
              />
            </div>
          </div>
          <div className="pt-4 flex gap-3 border-t border-slate-100 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsNewPatientModalOpen(false)}
              className="flex-1 py-3.5 rounded-xl cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer disabled:opacity-50 font-bold"
            >
              {isSubmitting ? "Guardando..." : "Crear Expediente"}
            </Button>
          </div>
        </form>
      </Modal>

      <EditPatientModal
        isOpen={!!patientToEditId}
        patientId={patientToEditId}
        onClose={() => setPatientToEditId(null)}
        onSaved={loadData}
      />

      <Modal
        isOpen={!!patientToBlock}
        onClose={() => setPatientToBlock(null)}
        title="Suspender Paciente"
        icon={<ShieldAlert className="w-5 h-5 text-amber-500" />}
        hideFooter={true}
      >
        {patientToBlock && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-2 text-amber-500">
              <Ban className="w-8 h-8" strokeWidth={2.5} />
            </div>
            <h3 className="text-xl font-bold text-brand-dark">
              ¿Suspender a {patientToBlock.name}?
            </h3>
            <p className="text-brand-gray">
              El paciente no podrá agendar nuevas citas desde el portal público.
            </p>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button type="button"
                variant="outline"
                onClick={() => setPatientToBlock(null)}
                className="flex-1 py-3.5 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button type="button"
                onClick={() => handleChangeStatus(patientToBlock.id, "blocked")}
                disabled={isSubmitting}
                className="flex-1 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white border-none shadow-md cursor-pointer disabled:opacity-50"
              >
                Sí, Suspender
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!patientToArchive}
        onClose={() => setPatientToArchive(null)}
        title="Archivar Expediente"
        icon={<Archive className="w-5 h-5 text-rose-500" />}
        hideFooter={true}
      >
        {patientToArchive && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-2 text-rose-500">
              <Archive className="w-8 h-8" strokeWidth={2.5} />
            </div>
            <h3 className="text-xl font-bold text-brand-dark">
              ¿Archivar a {patientToArchive.name}?
            </h3>
            <p className="text-brand-gray">
              El expediente se conservará intacto por 5 años en cumplimiento
              normativo.
            </p>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button type="button"
                variant="outline"
                onClick={() => setPatientToArchive(null)}
                className="flex-1 py-3.5 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button type="button"
                onClick={() =>
                  handleChangeStatus(patientToArchive.id, "archived")
                }
                disabled={isSubmitting}
                className="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white border-none shadow-md cursor-pointer disabled:opacity-50"
              >
                Sí, Archivar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
