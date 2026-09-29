import { Loader2, Trash2 } from "lucide-react";
import { SupplyAdder, supplyQuantityClasses } from "./SupplyAdder";
import type { SuppliesUsed } from "./useSuppliesUsed";

interface Props {
  supplies: SuppliesUsed;
  /** id for the section title; it also names the item picker. */
  labelId: string;
  /** Shown when the inventory could not be loaded. */
  loadFailedMessage: string;
}

/**
 * "Insumos usados": the editable list with each item's current stock, an
 * inline warning when a quantity is above it, and the item picker.
 */
export const SuppliesUsedList = ({
  supplies,
  labelId,
  loadFailedMessage,
}: Props) => (
  <div className="space-y-2">
    <p id={labelId} className="text-brand-dark font-bold text-sm">
      Insumos usados
    </p>
    {supplies.isLoading ? (
      <div className="py-2 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
        <p className="text-xs text-brand-gray">Cargando insumos...</p>
      </div>
    ) : supplies.loadFailed ? (
      <p className="text-xs text-brand-gray">{loadFailedMessage}</p>
    ) : (
      <>
        {supplies.lines.length === 0 ? (
          <p className="text-xs text-brand-gray">Sin insumos anotados.</p>
        ) : (
          <ul className="space-y-2">
            {supplies.lines.map((line) => {
              const item = supplies.itemsById.get(line.itemId);
              const name = item?.name ?? "Artículo";
              const stock = item?.stock_quantity ?? 0;
              const problem = supplies.lineProblem(line);
              return (
                <li
                  key={line.itemId}
                  className="bg-slate-50 rounded-xl px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-brand-dark">
                        {name}
                      </span>
                      <span className="text-xs text-brand-gray">
                        En inventario: {stock}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        aria-label={`Cantidad de ${name}`}
                        value={line.quantity}
                        onChange={(e) =>
                          supplies.setQuantity(line.itemId, e.target.value)
                        }
                        onFocus={(e) => e.target.select()}
                        className={supplyQuantityClasses}
                      />
                      <span className="text-xs text-brand-gray">
                        {item?.unit_measure}
                      </span>
                      <button
                        type="button"
                        onClick={() => supplies.remove(line.itemId)}
                        aria-label={`Quitar ${name}`}
                        title="Quitar"
                        className="flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm cursor-pointer bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500"
                      >
                        <Trash2 className="w-5 h-5" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                  {problem === "over" && (
                    <p className="text-xs font-semibold text-rose-600 mt-1">
                      Solo hay {stock} en inventario
                    </p>
                  )}
                  {problem === "invalid" && (
                    <p className="text-xs font-semibold text-rose-600 mt-1">
                      Escribe una cantidad entera (0 si no se usó).
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <SupplyAdder
          items={supplies.addableItems}
          onAdd={supplies.add}
          labelledBy={labelId}
        />
      </>
    )}
  </div>
);
