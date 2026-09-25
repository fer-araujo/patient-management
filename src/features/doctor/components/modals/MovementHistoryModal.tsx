import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Modal } from "../../../../components/ui/Modal";
import {
  fetchMovements,
  formatMXN,
  type InventoryItem,
  type InventoryMovement,
  type MovementType,
} from "../../../../lib/services/inventoryService";

const TYPE_LABELS: Record<MovementType, string> = {
  purchase: "Compra",
  use: "Uso",
  adjustment: "Ajuste",
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
}

interface LoadState {
  itemId: string;
  movements: InventoryMovement[];
  error: string | null;
}

export const MovementHistoryModal = ({ isOpen, onClose, item }: Props) => {
  const [loaded, setLoaded] = useState<LoadState | null>(null);

  const itemId = isOpen ? item?.id : undefined;

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    fetchMovements(itemId)
      .then((movements) => {
        if (!cancelled) setLoaded({ itemId, movements, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({
          itemId,
          movements: [],
          error:
            error instanceof Error
              ? error.message
              : "No se pudo cargar el historial.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const current = loaded && loaded.itemId === itemId ? loaded : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Historial"
      icon={<History className="w-5 h-5 text-brand-primary" />}
      hideFooter={true}
      maxWidth="max-w-md"
    >
      {item && (
        <p className="text-brand-dark font-bold text-sm">{item.name}</p>
      )}

      {!current ? (
        <div className="py-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
        </div>
      ) : current.error ? (
        <p className="text-xs text-brand-gray">{current.error}</p>
      ) : current.movements.length === 0 ? (
        <p className="text-xs text-brand-gray">Sin movimientos todavía.</p>
      ) : (
        <ul className="space-y-2">
          {current.movements.map((m) => (
            <li key={m.id} className="bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  {TYPE_LABELS[m.type]}
                </span>
                <span className="text-sm font-semibold text-brand-dark">
                  {m.quantity > 0 ? `+${m.quantity}` : `−${Math.abs(m.quantity)}`}{" "}
                  <span className="font-normal text-xs uppercase opacity-70 ml-0.5">
                    {item?.unit_measure}
                  </span>
                </span>
              </div>
              <p className="text-xs text-brand-gray font-medium">
                {formatDateTime(m.created_at)}
                {m.total_cost !== null &&
                  ` · ${formatMXN(Number(m.total_cost))} total` +
                    (m.unit_cost !== null
                      ? ` (${formatMXN(Number(m.unit_cost))} c/u)`
                      : "")}
              </p>
              {m.note && (
                <p className="text-xs text-brand-gray font-medium">{m.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
