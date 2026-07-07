import { useState, useEffect } from "react";
import { Loader2, Save, Stethoscope, Edit2 } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { Button } from "../../../../components/ui/Button";
import {
  createService,
  updateService,
  type ClinicService,
  type ServiceFormData,
} from "../../../../lib/services/catalogService";

const CATEGORY_OPTIONS = [
  { label: "General / Valoración", value: "General" },
  { label: "Medicina Regenerativa", value: "Regenerativo" },
  { label: "Armonización Facial", value: "Armonización" },
  { label: "Tratamiento Corporal", value: "Corporal" },
  { label: "Lifting (Hilos)", value: "Lifting" },
  { label: "Terapia Intravenosa (IV)", value: "Salud Integral" },
  { label: "Anti-Aging / Botox", value: "Anti-Aging" },
  { label: "Otro", value: "Otro" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  serviceToEdit?: ClinicService | null;
}

export const ServiceModal = ({
  isOpen,
  onClose,
  onSaved,
  serviceToEdit,
}: Props) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<ServiceFormData>({
    name: "",
    category: "General",
    durationMins: 45,
    price: 0,
    description: "",
    careGuide: "",
  });

  useEffect(() => {
    if (serviceToEdit) {
      setFormData({
        name: serviceToEdit.name,
        category: serviceToEdit.category,
        durationMins: serviceToEdit.durationMins,
        price: serviceToEdit.price || 0,
        description: serviceToEdit.description || "",
        careGuide: serviceToEdit.careGuide || "",
      });
    } else {
      setFormData({
        name: "",
        category: "General",
        durationMins: 45,
        price: 0,
        description: "",
        careGuide: "",
      });
    }
  }, [serviceToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (serviceToEdit) {
        await updateService(serviceToEdit.id, formData);
        toast.success("Tratamiento actualizado correctamente");
      } else {
        await createService(formData);
        toast.success("Nuevo tratamiento agregado al catálogo");
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      console.error("[ServiceModal] Error al guardar el servicio:", error);
      toast.error("Ocurrió un error al guardar los datos");
    } finally {
      setIsLoading(false);
    }
  };

  // Clases compartidas para encoger los componentes base
  const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
  const compactLabelClasses =
    "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={serviceToEdit ? "Editar Tratamiento" : "Añadir Tratamiento"}
      icon={
        serviceToEdit ? (
          <Edit2 className="w-5 h-5 text-brand-primary" />
        ) : (
          <Stethoscope className="w-5 h-5 text-brand-primary" />
        )
      }
      hideFooter={true}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Nombre del Servicio"
            type="text"
            placeholder="Ej. Terapia Integrativa"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
          <div className="w-full">
            <label className="text-brand-dark font-bold text-sm mb-2 block">
              Categoría
            </label>
            <Dropdown
              options={CATEGORY_OPTIONS}
              value={formData.category}
              onChange={(val) => setFormData({ ...formData, category: val })}
              className="py-0! text-sm!" // El dropdown base usa py-3 internamente, lo mitigamos
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Duración (minutos)"
            type="number"
            min={15}
            step={15}
            value={formData.durationMins.toString()}
            onChange={(e) =>
              setFormData({
                ...formData,
                durationMins: parseInt(e.target.value) || 45,
              })
            }
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
          <Input
            label="Precio (MXN) - Opcional"
            type="number"
            min={0}
            placeholder="0"
            value={formData.price ? formData.price.toString() : ""}
            onChange={(e) =>
              setFormData({
                ...formData,
                price: parseFloat(e.target.value) || null,
              })
            }
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="text-sm font-bold text-brand-dark">
            Descripción Pública
          </label>
          <textarea
            rows={2}
            placeholder="Breve descripción que verá el paciente al agendar..."
            // Copiamos las clases exactas del input base pero versión compacta
            className="w-full px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-bold text-brand-dark">
            Guía de Cuidados (Uso interno)
          </label>
          <textarea
            rows={2}
            placeholder="Instrucciones post-tratamiento o notas médicas internas..."
            className="w-full px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
            value={formData.careGuide}
            onChange={(e) =>
              setFormData({ ...formData, careGuide: e.target.value })
            }
          />
        </div>

        <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="px-6 py-2.5 cursor-pointer text-sm"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {serviceToEdit ? "Guardar Cambios" : "Crear Servicio"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
