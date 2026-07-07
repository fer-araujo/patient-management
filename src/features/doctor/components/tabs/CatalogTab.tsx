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
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import { Button } from "../../../../components/ui/Button";
import { motion } from "framer-motion";

export const CatalogTab = () => {
  const [services, setServices] = useState<ClinicService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serviceToEdit, setServiceToEdit] = useState<ClinicService | null>(
    null,
  );

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
      accessorKey: "name",
      sortable: true,
      className: "w-[30%]",
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
      accessorKey: "description",
      className: "w-[40%]",
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
      header: "Acciones",
      className: "w-[15%] text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setServiceToEdit(row);
              setIsModalOpen(true);
            }}
            className="flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer"
            title="Editar Tratamiento"
          >
            <Edit2 className="w-5 h-5" strokeWidth={2.5} />
          </button>

          <button
            onClick={() => handleToggleStatus(row)}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm cursor-pointer ${
              row.isActive
                ? "bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500"
                : "bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500"
            }`}
            title={row.isActive ? "Desactivar" : "Activar"}
          >
            <Power className="w-5 h-5" strokeWidth={2.5} />
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
    </motion.div>
  );
};
