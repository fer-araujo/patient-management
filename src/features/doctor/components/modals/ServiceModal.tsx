import { useState, useEffect, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Loader2,
  Save,
  Stethoscope,
  Edit2,
  Trash2,
  Minus,
  Plus,
} from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { Button } from "../../../../components/ui/Button";
import {
  createService,
  setServiceSupplies,
  updateService,
  type ClinicService,
  type ServiceFormData,
} from "../../../../lib/services/catalogService";
import {
  fetchInventory,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";
import { InventoryModal, type CreatedItem } from "./InventoryModal";
import { SupplyAdder } from "./SupplyAdder";
import { supplyQuantityInputId } from "./supplyQuantityInput";

/** A line of "Insumos que usa" while it is being edited. */
interface SupplyLine {
  itemId: string;
  itemName: string;
  unit: string;
  /** Kept as typed, so the field can be cleared while editing. */
  quantity: string;
}

const isValidQuantity = (value: string) => {
  const n = Number(value);
  return value !== "" && Number.isInteger(n) && n > 0;
};

/** How long a newly added supply stays highlighted. */
const HIGHLIGHT_MS = 2000;

const sameText = (a: string, b: string) =>
  a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

/**
 * The item just created: by id, or, when the insert did not return one, the
 * only active item with the same name and unit.
 */
const findCreatedItem = (
  items: InventoryItem[],
  createdId?: string,
  created?: CreatedItem,
): InventoryItem | null => {
  if (createdId) return items.find((i) => i.id === createdId) ?? null;
  if (!created) return null;
  const matches = items.filter(
    (i) =>
      i.is_active &&
      sameText(i.name, created.name) &&
      sameText(i.unit_measure, created.unit),
  );
  return matches.length === 1 ? matches[0] : null;
};

/** Small square buttons of a supply row: 44 px on touch. */
const rowIconButton =
  "flex items-center justify-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg border transition-all cursor-pointer";
const stepperButton = `${rowIconButton} bg-white text-brand-dark border-brand-light hover:border-brand-primary disabled:opacity-40 disabled:cursor-not-allowed`;
const stepperInput =
  "w-14 px-1 py-1.5 border-2 border-brand-light rounded-lg text-sm text-center text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all";
/** Same segmented control as the Pacientes status filter. */
const segmentButton = (active: boolean) =>
  `cursor-pointer flex-1 px-4 py-2 pointer-coarse:min-h-11 rounded-lg text-sm font-bold transition-all ${active ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`;

type Section = "datos" | "insumos";

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
  const [supplies, setSupplies] = useState<SupplyLine[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  // "Nuevo insumo": the inventory form, stacked over this one.
  const [isNewSupplyOpen, setIsNewSupplyOpen] = useState(false);
  // One section at a time keeps the modal from growing with the supplies.
  const [section, setSection] = useState<Section>("datos");
  // The last added supply is listed first, and highlighted for a moment.
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  useEffect(() => {
    setSection("datos");
    setLastAddedId(null);
    setHighlightedId(null);
    setSupplies(
      (serviceToEdit?.supplies ?? []).map((s) => ({
        itemId: s.itemId,
        itemName: s.itemName,
        unit: s.unit,
        quantity: String(s.quantity),
      })),
    );
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

  // Only the latest inventory request may write the list, so a slow load
  // started when the modal opened cannot overwrite a newer reload.
  const inventoryRequestRef = useRef(0);
  // Bumped on every open and close: work started in one opening of the modal
  // must not touch the next one.
  const sessionRef = useRef(0);
  const isOpenRef = useRef(isOpen);

  /** Fetches the items; writes them only if no newer request started. */
  const loadInventory = async () => {
    const request = ++inventoryRequestRef.current;
    const items = await fetchInventory();
    if (request === inventoryRequestRef.current) setInventory(items);
    return items;
  };

  // Items for "Insumos que usa": loaded each time the modal opens, so a
  // freshly added inventory item shows up.
  useEffect(() => {
    isOpenRef.current = isOpen;
    sessionRef.current += 1;
    if (!isOpen) {
      inventoryRequestRef.current += 1; // drop any load still in flight
      return;
    }
    const request = inventoryRequestRef.current + 1;
    loadInventory().catch((error: unknown) => {
      console.error("[ServiceModal] Error al cargar el inventario:", error);
      if (request === inventoryRequestRef.current) setInventory([]);
    });
  }, [isOpen]);

  const activeItems = inventory.filter((i) => i.is_active);
  const suppliesAreValid = supplies.every((s) => isValidQuantity(s.quantity));

  /** Adds the item with quantity 1; an item already listed is kept once. */
  const addSupply = (item: InventoryItem) => {
    setLastAddedId(item.id);
    setHighlightedId(item.id);
    setSupplies((current) =>
      current.some((s) => s.itemId === item.id)
        ? current
        : [
            ...current,
            {
              itemId: item.id,
              itemName: item.name,
              unit: item.unit_measure,
              quantity: "1",
            },
          ],
    );
  };

  /** Stepper: +1 / -1, never below 1 (the trash button removes it). */
  const stepSupplyQuantity = (itemId: string, step: 1 | -1) =>
    setSupplies((current) =>
      current.map((s) => {
        if (s.itemId !== itemId) return s;
        const n = isValidQuantity(s.quantity) ? Number(s.quantity) : 0;
        return { ...s, quantity: String(Math.max(1, n + step)) };
      }),
    );

  /** Alphabetical, with the one just added on top. */
  const sortedSupplies = [...supplies].sort((a, b) =>
    a.itemId === lastAddedId
      ? -1
      : b.itemId === lastAddedId
        ? 1
        : a.itemName.localeCompare(b.itemName, "es"),
  );

  /**
   * A required field of "Datos" failed while "Insumos" was showing: switch
   * back synchronously so the browser can focus it and show its message.
   */
  const handleInvalid = (e: React.FormEvent<HTMLFormElement>) => {
    if (section === "datos") return;
    const field = e.target;
    flushSync(() => setSection("datos"));
    if (field instanceof HTMLElement) field.focus();
  };

  const changeSupplyQuantity = (itemId: string, quantity: string) =>
    setSupplies((current) =>
      current.map((s) => (s.itemId === itemId ? { ...s, quantity } : s)),
    );

  const removeSupply = (itemId: string) =>
    setSupplies((current) => current.filter((s) => s.itemId !== itemId));

  /**
   * Reloads the items and adds the one just created, as if it was picked.
   * Does nothing if this modal was closed (or reopened) meanwhile.
   */
  const handleSupplyCreated = async (
    createdId?: string,
    created?: CreatedItem,
  ) => {
    const session = sessionRef.current;
    const isSameSession = () =>
      isOpenRef.current && session === sessionRef.current;

    let items: InventoryItem[];
    try {
      items = await loadInventory();
    } catch (error: unknown) {
      console.error("[ServiceModal] Error al recargar el inventario:", error);
      if (isSameSession()) {
        toast.error("El insumo se guardó, pero no se pudo cargar la lista.");
      }
      return;
    }
    if (!isSameSession()) return;

    const item = findCreatedItem(items, createdId, created);
    if (item) addSupply(item);
    else toast("Insumo creado; selecciónalo en la lista");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppliesAreValid) return;
    setIsLoading(true);

    const supplyQuantities = supplies.map((s) => ({
      itemId: s.itemId,
      quantity: Number(s.quantity),
    }));
    let createdServiceId: string | null = null;

    try {
      if (serviceToEdit) {
        await updateService(serviceToEdit.id, formData);
        await setServiceSupplies(serviceToEdit.id, supplyQuantities);
        toast.success("Tratamiento actualizado correctamente");
      } else {
        createdServiceId = await createService(formData);
        await setServiceSupplies(createdServiceId, supplyQuantities);
        toast.success("Nuevo tratamiento agregado al catálogo");
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      console.error("[ServiceModal] Error al guardar el servicio:", error);
      if (createdServiceId) {
        // The new service exists; closing avoids creating it twice on retry.
        toast.error(
          "El tratamiento se guardó, pero sus insumos no. Ábrelo de nuevo para agregarlos.",
        );
        onSaved();
        onClose();
      } else {
        toast.error("Ocurrió un error al guardar los datos");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Clases compartidas para encoger los componentes base
  const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
  const compactLabelClasses =
    "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";

  return (
    <>
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
        <form
          onSubmit={handleSubmit}
          onInvalidCapture={handleInvalid}
          className="space-y-4"
        >
          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full">
            <button
              type="button"
              onClick={() => setSection("datos")}
              aria-pressed={section === "datos"}
              className={segmentButton(section === "datos")}
            >
              Datos del servicio
            </button>
            <button
              type="button"
              onClick={() => setSection("insumos")}
              aria-pressed={section === "insumos"}
              className={segmentButton(section === "insumos")}
            >
              Insumos ({supplies.length})
            </button>
          </div>

          {/* Kept mounted while hidden, so its required fields still validate. */}
          <div hidden={section !== "datos"} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Nombre del Servicio"
                type="text"
                placeholder="Ej. Terapia Integrativa"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
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
                  onChange={(val) =>
                    setFormData({ ...formData, category: val })
                  }
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
          </div>

          {section === "insumos" && (
            <div className="space-y-2">
              {/* Pinned: only the list below scrolls, inside the modal body. */}
              <div className="sticky top-0 z-10 bg-white pb-1">
                <p id="service-supplies-label" className="sr-only">
                  Insumos que usa
                </p>
                <SupplyAdder
                  items={activeItems}
                  listedIds={supplies.map((s) => s.itemId)}
                  onAdd={addSupply}
                  labelledBy="service-supplies-label"
                  onCreateNew={() => setIsNewSupplyOpen(true)}
                />
              </div>
              {supplies.length === 0 ? (
                <p className="text-sm text-brand-gray">
                  Este servicio no usa insumos
                </p>
              ) : (
                <ul className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6">
                  {sortedSupplies.map((s) => (
                    <li
                      key={s.itemId}
                      className={`border-b border-brand-light py-1.5 px-1 transition-colors duration-700 ${s.itemId === highlightedId ? "bg-brand-primary/10" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-sm font-semibold text-brand-dark">
                          {s.itemName}{" "}
                          <span className="text-xs font-normal text-brand-gray">
                            {s.unit}
                          </span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => stepSupplyQuantity(s.itemId, -1)}
                            disabled={Number(s.quantity) <= 1}
                            aria-label={`Menos ${s.itemName}`}
                            className={stepperButton}
                          >
                            <Minus className="w-4 h-4" strokeWidth={2.5} />
                          </button>
                          <input
                            id={supplyQuantityInputId(
                              "service-supplies-label",
                              s.itemId,
                            )}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            aria-label={`Cantidad de ${s.itemName}`}
                            value={s.quantity}
                            onChange={(e) =>
                              changeSupplyQuantity(s.itemId, e.target.value)
                            }
                            className={stepperInput}
                          />
                          <button
                            type="button"
                            onClick={() => stepSupplyQuantity(s.itemId, 1)}
                            aria-label={`Más ${s.itemName}`}
                            className={stepperButton}
                          >
                            <Plus className="w-4 h-4" strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSupply(s.itemId)}
                            aria-label={`Quitar ${s.itemName}`}
                            title="Quitar"
                            className={`${rowIconButton} shadow-sm bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500`}
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                      {!isValidQuantity(s.quantity) && (
                        <p className="text-xs font-semibold text-rose-600 mt-1">
                          Escribe una cantidad de 1 o más, o quítalo.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-brand-gray mt-1 flex items-center">
                * Al finalizar una consulta de este tratamiento, estos insumos
                aparecerán ya anotados para descontarlos del inventario.
              </p>
            </div>
          )}

          {section === "datos" && !suppliesAreValid && (
            <p className="text-xs font-semibold text-rose-600">
              Revisa las cantidades en Insumos.
            </p>
          )}

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
              disabled={isLoading || !suppliesAreValid}
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
      {/* Portaled after everything else so it stacks over this modal, and so
        its form submit does not bubble (through React) into this form. */}
      {createPortal(
        <InventoryModal
          isOpen={isOpen && isNewSupplyOpen}
          onClose={() => setIsNewSupplyOpen(false)}
          onSaved={handleSupplyCreated}
        />,
        document.body,
      )}
    </>
  );
};
