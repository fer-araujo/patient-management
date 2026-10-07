import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Edit2,
  Loader2,
  Power,
  Search,
  Clock,
  CircleDollarSign,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  fetchAllServices,
  toggleServiceStatus,
  type ClinicService,
} from "../../../../lib/services/catalogService";
import { ServiceModal } from "../modals/ServiceModal";
import { Modal } from "../../../../components/ui/Modal";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  TOUCH_ICON_BUTTON,
  TOUCH_LABELED_BUTTON,
  TOUCH_ONLY_LABEL,
  PHONE_LABELED_BUTTON,
  PHONE_ONLY_LABEL,
} from "../../../../components/ui/touchTargets";
import { Button } from "../../../../components/ui/Button";
import { motion } from "framer-motion";

/** How many supply names the "Insumos" column shows before "+N más". */
const SUPPLY_NAMES_SHOWN = 2;

/** "Sculptra, Jeringas +6 más": short enough for the table cell. */
const summarizeSupplies = (
  supplies: NonNullable<ClinicService["supplies"]>,
) => {
  const names = supplies.map((s) => s.itemName);
  const rest = names.length - SUPPLY_NAMES_SHOWN;
  const shown = names.slice(0, SUPPLY_NAMES_SHOWN).join(", ");
  return rest > 0 ? `${shown} +${rest} más` : shown;
};

export const CatalogTab = () => {
  const [services, setServices] = useState<ClinicService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serviceToEdit, setServiceToEdit] = useState<ClinicService | null>(
    null,
  );
  // Full "Insumos" list of one service, opened from its table cell. The
  // service is kept while the modal animates out.
  const [suppliesOf, setSuppliesOf] = useState<ClinicService | null>(null);
  const [isSuppliesOpen, setIsSuppliesOpen] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAllServices();
      setServices(data);
    } catch (error: unknown) {
      console.error(
        "[CatalogTab] Error al cambiar estado del servicio:",
        error,
      );
      toast.error("Error al cargar el catálogo");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleStatus = async (service: ClinicService) => {
    try {
      setServices(
        services.map((s) =>
          s.id === service.id ? { ...s, isActive: !s.isActive } : s,
        ),
      );
      await toggleServiceStatus(service.id, service.isActive);
      toast.success(
        service.isActive ? "Servicio ocultado al público" : "Servicio activado",
      );
    } catch (error: unknown) {
      console.error(
        "[CatalogTab] Error al cambiar estado del servicio:",
        error,
      );
      toast.error("No se pudo cambiar el estado");
      loadData();
    }
  };

  const openNewModal = () => {
    setServiceToEdit(null);
    setIsModalOpen(true);
  };

  const filteredData = useMemo(() => {
    return services.filter(
      (service) =>
        service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        service.category.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [services, searchTerm]);

  // =========================================================================
  // CONFIGURACIÓN DEL DATAGRID (CLON EXACTO DE INBOXTAB)
  // =========================================================================
  const columns: ColumnDef<ClinicService>[] = [
    {
      header: "Tratamiento",
      mobileRole: "title",
      accessorKey: "name",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => (
        <div
          className={`flex flex-col items-start ${!row.isActive && "opacity-50"}`}
        >
          <span
            className={`font-bold text-sm ${row.isActive ? "text-brand-dark" : "text-brand-gray line-through"}`}
          >
            {row.name}
          </span>
          <span className="text-[10px] font-bold text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 rounded-md mt-1 uppercase tracking-wider">
            {row.category}
          </span>
        </div>
      ),
    },
    {
      header: "Descripción",
      mobileRole: "meta",
      mobileWide: true,
      accessorKey: "description",
      className: "w-[30%]",
      cell: (row) => (
        <span
          className={`text-sm font-medium ${row.isActive ? "text-brand-gray" : "text-slate-400"}`}
        >
          {row.description || "Sin descripción pública"}
        </span>
      ),
    },
    {
      header: "Detalles",
      mobileRole: "meta",
      accessorKey: "durationMins",
      sortable: true,
      className: "w-[15%]",
      cell: (row) => (
        <div
          className={`flex flex-col gap-1.5 text-sm font-medium ${row.isActive ? "text-brand-dark" : "text-slate-400"}`}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-gray/50 shrink-0" />
            {row.durationMins} min
          </div>
          <div className="flex items-center gap-2">
            <CircleDollarSign className="w-4 h-4 text-brand-gray/50 shrink-0" />
            {row.price ? `$${row.price}` : "Variable"}
          </div>
        </div>
      ),
    },
    {
      header: "Insumos",
      mobileRole: "meta",
      className: "w-[15%]",
      cell: (row) =>
        row.supplies && row.supplies.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSuppliesOf(row);
              setIsSuppliesOpen(true);
            }}
            aria-label={`Ver insumos de ${row.name}`}
            title="Ver insumos"
            className={`pointer-coarse:min-h-11 max-md:min-h-11 text-left text-sm font-medium hover:underline cursor-pointer ${row.isActive ? "text-brand-gray" : "text-slate-400"}`}
          >
            {summarizeSupplies(row.supplies)}
          </button>
        ) : (
          <span
            className={`text-sm font-medium ${row.isActive ? "text-brand-gray" : "text-slate-400"}`}
          >
            —
          </span>
        ),
    },
    {
      header: "Acciones",
      mobileRole: "actions",
      className: "w-[15%] text-right",
      stickyRight: true,
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setServiceToEdit(row);
              setIsModalOpen(true);
            }}
            className={`flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer ${TOUCH_ICON_BUTTON} ${PHONE_LABELED_BUTTON}`}
            title="Editar Tratamiento"
            aria-label="Editar Tratamiento"
          >
            <Edit2 className="w-5 h-5" strokeWidth={2.5} />
            <span className={PHONE_ONLY_LABEL}>Editar</span>
          </button>

          <button
            onClick={() => handleToggleStatus(row)}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON} ${
              row.isActive
                ? "bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500"
                : "bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500"
            }`}
            title={row.isActive ? "Desactivar" : "Activar"}
            aria-label={row.isActive ? "Desactivar" : "Activar"}
          >
            <Power className="w-5 h-5" strokeWidth={2.5} />
            <span className={TOUCH_ONLY_LABEL}>
              {row.isActive ? "Desactivar" : "Activar"}
            </span>
          </button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">Sincronizando catálogo...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* BARRA DE BÚSQUEDA Y BOTÓN AÑADIR (Alineado con InboxTab) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar tratamiento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-[0_2px_10px_rgb(0,0,0,0.02)] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
          />
        </div>
        <Button
          onClick={openNewModal}
          className="px-5 py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 font-bold w-full sm:w-auto shrink-0 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Añadir Tratamiento
        </Button>
      </div>

      {/* TABLA PRINCIPAL */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <DataGrid
          data={filteredData}
          columns={columns}
          keyExtractor={(row) => row.id}
          itemsPerPage={10}
        />
      </div>

      <ServiceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={loadData}
        serviceToEdit={serviceToEdit}
      />

      <Modal
        isOpen={isSuppliesOpen}
        onClose={() => setIsSuppliesOpen(false)}
        title={`Insumos de ${suppliesOf?.name ?? ""}`}
        maxWidth="max-w-md"
      >
        <ul>
          {(suppliesOf?.supplies ?? []).map((s) => (
            <li
              key={s.itemId}
              className="flex items-center justify-between gap-2 border-b border-brand-light py-2"
            >
              <span className="text-sm font-semibold text-brand-dark">
                {s.itemName}
              </span>
              <span className="text-sm text-brand-gray">
                {s.quantity} {s.unit}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </motion.div>
  );
};
