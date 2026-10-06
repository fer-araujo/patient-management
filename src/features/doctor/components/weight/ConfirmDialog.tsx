import type { ReactNode } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  icon: ReactNode;
  question: string;
  description: string;
  confirmLabel: string;
  isBusy?: boolean;
  /** "danger" for an action that removes data. */
  tone?: "primary" | "danger";
}

/**
 * Same layout as the directory's "Suspender / Archivar" confirmations. While
 * `isBusy` it cannot be dismissed (Cancelar, backdrop, Escape): the action's
 * result must land on an open dialog, never on one she already closed.
 */
export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  icon,
  question,
  description,
  confirmLabel,
  isBusy = false,
  tone = "primary",
}: ConfirmDialogProps) => (
  <Modal isOpen={isOpen} onClose={isBusy ? () => {} : onClose} title={title} hideFooter={true}>
    <div className="space-y-6 pb-2 text-center">
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 ${tone === "danger" ? "bg-rose-50 text-rose-500" : "bg-brand-light text-brand-primary"}`}
      >
        {icon}
      </div>
      <h3 className="text-xl font-bold text-brand-dark">{question}</h3>
      <p className="text-base text-brand-gray">{description}</p>
      <div className="pt-4 border-t border-slate-100 flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isBusy}
          className="flex-1 py-3.5 rounded-xl cursor-pointer disabled:opacity-50"
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isBusy}
          className={`flex-1 py-3.5 rounded-xl text-white border-none shadow-md cursor-pointer disabled:opacity-50 ${tone === "danger" ? "bg-rose-500 hover:bg-rose-600" : ""}`}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Modal>
);
