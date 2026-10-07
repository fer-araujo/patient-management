import { useState } from "react";
import { Loader2, Package, Save } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { recordConsultationSupplies } from "../../../../lib/services/soapService";
import { useSuppliesUsed } from "./useSuppliesUsed";
import { SuppliesUsedList } from "./SuppliesUsedList";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called once the server recorded the supplies. */
  onSaved: () => void;
  appointmentId: string;
  /** Catalog service of the appointment, to pre-fill the supplies. */
  serviceId?: string | null;
  /** Shown under the title, e.g. "Ana Pérez · Valoración". */
  subtitle?: string;
}

/**
 * "Registrar insumos": the supplies of a finalized consultation that was
 * closed without them. Same list and stock checks as the charge step.
 */
export const RecordSuppliesModal = ({
  isOpen,
  onClose,
  onSaved,
  appointmentId,
  serviceId,
  subtitle,
}: Props) => {
  const [isSaving, setIsSaving] = useState(false);
  const supplies = useSuppliesUsed({ enabled: isOpen, serviceId });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const used = supplies.toSupplies();
    if (!supplies.isValid || used === undefined || isSaving) return;
    setIsSaving(true);
    try {
      await recordConsultationSupplies(appointmentId, used);
      toast.success("Insumos registrados");
      onSaved();
    } catch (error: unknown) {
      console.error("[RecordSuppliesModal] Error al registrar insumos:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron registrar los insumos.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar insumos"
      icon={<Package className="w-5 h-5 text-brand-primary" />}
      hideFooter={true}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {subtitle && (
          <p className="text-brand-dark font-bold text-sm">{subtitle}</p>
        )}

        <SuppliesUsedList
          supplies={supplies}
          labelId="record-supplies-label"
          loadFailedMessage="No se pudieron cargar los insumos. Cierra e intenta de nuevo."
        />

        <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
            disabled={isSaving || !supplies.isValid || supplies.loadFailed}
            className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Guardar insumos
          </Button>
        </div>
      </form>
    </Modal>
  );
};
