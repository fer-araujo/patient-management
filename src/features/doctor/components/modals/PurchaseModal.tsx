import { useState } from "react";
import { Loader2, Plus, Save, ShoppingCart } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Button } from "../../../../components/ui/Button";
import {
  adjustStock,
  computeUnitCost,
  formatMXN,
  registerPurchase,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";

/**
 * "purchase": the cart action, always a purchase with its cost.
 * "add": the + button. Every increase asks whether it was bought, so stock
 * never enters the ledger without its cost by accident.
 */
export type PurchaseModalMode = "purchase" | "add";

type AddKind = "purchase" | "correction";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (itemId: string, newStock: number) => void;
  item: InventoryItem | null;
  mode?: PurchaseModalMode;
  /** Pre-filled quantity (the + button opens with 1). */
  initialQuantity?: number;
}

export const PurchaseModal = ({
  isOpen,
  onClose,
  onSaved,
  item,
  mode = "purchase",
  initialQuantity,
}: Props) => {
  const [isLoading, setIsLoading] = useState(false);
  const [quantity, setQuantity] = useState(
    initialQuantity ? String(initialQuantity) : "",
  );
  const [totalCost, setTotalCost] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<AddKind>("purchase");

  const isPurchase = mode === "purchase" || kind === "purchase";
  const parsedQuantity = Number(quantity);
  const parsedTotal = Number(totalCost);
  const isQuantityValid =
    quantity !== "" && Number.isInteger(parsedQuantity) && parsedQuantity > 0;
  const isCostValid =
    totalCost !== "" && Number.isFinite(parsedTotal) && parsedTotal >= 0;
  const isValid = isQuantityValid && (!isPurchase || isCostValid);
  const unitCost =
    isPurchase && isQuantityValid && isCostValid
      ? computeUnitCost(parsedTotal, parsedQuantity)
      : null;

  const handleClose = () => {
    setQuantity("");
    setTotalCost("");
    setNote("");
    setKind("purchase");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !isValid) return;
    setIsLoading(true);

    try {
      const newStock = isPurchase
        ? await registerPurchase(item.id, parsedQuantity, parsedTotal, note)
        : await adjustStock(
            item.id,
            parsedQuantity,
            "adjustment",
            undefined,
            note.trim() || "Corrección de conteo",
          );
      toast.success(isPurchase ? "Compra registrada" : "Corrección guardada");
      onSaved(item.id, newStock);
      handleClose();
    } catch (error: unknown) {
      console.error("[PurchaseModal] Error al guardar:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Ocurrió un error al guardar los datos",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
  const compactLabelClasses =
    "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";
  const choiceClasses = (selected: boolean) =>
    `rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all cursor-pointer ${
      selected
        ? "border-brand-primary bg-brand-light/40 text-brand-dark"
        : "border-brand-light bg-white text-brand-gray hover:border-brand-primary/40"
    }`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === "add" ? "Agregar unidades" : "Registrar compra"}
      icon={
        mode === "add" ? (
          <Plus className="w-5 h-5 text-brand-primary" />
        ) : (
          <ShoppingCart className="w-5 h-5 text-brand-primary" />
        )
      }
      hideFooter={true}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {item && (
          <p className="text-brand-dark font-bold text-sm">{item.name}</p>
        )}

        {mode === "add" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={kind === "purchase"}
              onClick={() => setKind("purchase")}
              className={choiceClasses(kind === "purchase")}
            >
              Sí, lo compré
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === "correction"}
              onClick={() => setKind("correction")}
              className={choiceClasses(kind === "correction")}
            >
              No, es una corrección
            </button>
          </div>
        )}

        <Input
          label={
            isPurchase
              ? "¿Cuántas unidades compraste?"
              : "¿Cuántas unidades agregas?"
          }
          id="purchase-quantity"
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          // Selected on open so typing replaces the pre-filled 1.
          autoFocus
          onFocus={(e) => e.target.select()}
          required
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
        {isPurchase && (
          <Input
            label="¿Cuánto pagaste en total? (MXN)"
            id="purchase-total"
            type="number"
            min={0}
            step={0.01}
            value={totalCost}
            onChange={(e) => setTotalCost(e.target.value)}
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
        )}
        <Input
          label="Nota (opcional)"
          id="purchase-note"
          type="text"
          placeholder={
            isPurchase ? "Ej. Proveedor o factura" : "Ej. Conteo físico"
          }
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
        {isPurchase && (
          <p
            className="text-xs text-brand-gray mt-1 flex items-center"
            data-testid="purchase-unit-cost"
          >
            Costo por unidad: {unitCost === null ? "—" : formatMXN(unitCost)}
          </p>
        )}

        <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="px-6 py-2.5 cursor-pointer text-sm"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isLoading || !isValid}
            className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isPurchase ? "Registrar compra" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
