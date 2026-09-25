import { useState } from "react";
import { CircleDollarSign, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Button } from "../../../../components/ui/Button";
import {
  PAYMENT_METHOD_LABELS,
  recordPayment,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
} from "../../../../lib/services/financeService";

const METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the stored payment once the server accepted it. */
  onSaved: (payment: Payment) => void;
  appointmentId: string;
  /** Shown under the title, e.g. "Ana Pérez · Valoración". */
  subtitle?: string;
  /** Catalog price of the service; pre-fills the amount. */
  servicePrice?: number | null;
  /** The charge already recorded, when editing it. */
  existing?: Payment | null;
  confirmLabel?: string;
}

/**
 * Asks whether the consultation was charged. Used before "Finalizar Consulta"
 * and from the calendar ("Registrar cobro" / "Editar cobro"). Mount it with a
 * key per appointment so it always opens with that appointment's values.
 */
export const ChargeModal = ({
  isOpen,
  onClose,
  onSaved,
  appointmentId,
  subtitle,
  servicePrice,
  existing,
  confirmLabel = "Guardar cobro",
}: Props) => {
  const initialAmount =
    existing?.status === "paid"
      ? existing.amountCharged
      : servicePrice && servicePrice > 0
        ? servicePrice
        : null;

  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>(
    existing?.status ?? "paid",
  );
  const [amount, setAmount] = useState(
    initialAmount === null ? "" : String(initialAmount),
  );
  const [method, setMethod] = useState<PaymentMethod | null>(
    existing?.method ?? null,
  );
  const [note, setNote] = useState(existing?.note ?? "");

  const isPaid = status === "paid";
  const parsedAmount = Number(amount);
  const isAmountValid =
    amount !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isValid = !isPaid || (isAmountValid && method !== null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isLoading) return;
    setIsLoading(true);

    try {
      const payment = await recordPayment({
        appointmentId,
        status,
        amount: isPaid ? parsedAmount : undefined,
        method: isPaid ? method : null,
        note,
      });
      toast.success(isPaid ? "Cobro guardado" : "Cortesía guardada");
      onSaved(payment);
    } catch (error: unknown) {
      console.error("[ChargeModal] Error al guardar el cobro:", error);
      toast.error(
        error instanceof Error ? error.message : "No se pudo guardar el cobro.",
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
      onClose={onClose}
      title="Cobro de la consulta"
      icon={<CircleDollarSign className="w-5 h-5 text-brand-primary" />}
      hideFooter={true}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {subtitle && (
          <p className="text-brand-dark font-bold text-sm">{subtitle}</p>
        )}

        <div
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="¿Cobraste la consulta?"
        >
          <button
            type="button"
            role="radio"
            aria-checked={isPaid}
            onClick={() => setStatus("paid")}
            className={choiceClasses(isPaid)}
          >
            Sí, cobré
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isPaid}
            onClick={() => setStatus("courtesy")}
            className={choiceClasses(!isPaid)}
          >
            No cobré (cortesía)
          </button>
        </div>

        {isPaid && (
          <>
            <Input
              label="¿Cuánto cobraste? (MXN)"
              id="charge-amount"
              type="number"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={(e) => e.target.select()}
              required
              containerClassName={`w-full ${compactLabelClasses}`}
              className={compactInputClasses}
            />
            <div className="space-y-2">
              <p
                id="charge-method-label"
                className="text-brand-dark font-bold text-sm"
              >
                ¿Cómo te pagó?
              </p>
              <div
                className="grid grid-cols-3 gap-2"
                role="radiogroup"
                aria-labelledby="charge-method-label"
              >
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                    className={choiceClasses(method === m)}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <Input
          label="Nota (opcional)"
          id="charge-note"
          type="text"
          placeholder={isPaid ? "Ej. Pagó la mitad" : "Ej. Familiar"}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />

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
            disabled={isLoading || !isValid}
            className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
