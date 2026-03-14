import { useState, useRef, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarSearch,
} from "lucide-react";
import { Modal } from "./Modal";

interface DatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  minDate?: string;
  maxDate?: string;
  isDateDisabled?: (dateStr: string) => boolean; // <-- NUEVA PROP PARA DÍAS BLOQUEADOS
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const DAY_NAMES = ["D", "L", "M", "M", "J", "V", "S"];
const SHORT_DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const SHORT_MONTH_NAMES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const parseDateStr = (str: string) => {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const formatDateObj = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const DatePicker = ({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  minDate,
  maxDate,
  isDateDisabled,
}: DatePickerProps) => {
  const today = new Date();
  const currentActualYear = today.getFullYear();
  const todayStr = formatDateObj(today);

  const [viewMode, setViewMode] = useState<"calendar" | "year">("calendar");
  const [viewDate, setViewDate] = useState<Date>(today);
  const [internalDate, setInternalDate] = useState<string | null>(null);
  const [yearPageStart, setYearPageStart] = useState<number>(currentActualYear); // Empezamos el grid en el año actual

  const currentYearRef = useRef<HTMLButtonElement>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setInternalDate(selectedDate);
      setViewMode("calendar");
      const d = selectedDate ? parseDateStr(selectedDate) : today;
      if (d) {
        setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
        // Ajustamos la página de años para que contenga el año seleccionado
        setYearPageStart(d.getFullYear() - (d.getFullYear() % 9));
      }
    }
  }

  useEffect(() => {
    if (viewMode === "year" && currentYearRef.current) {
      currentYearRef.current.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
    }
  }, [viewMode]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const handlePrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  // Paginación de años (bloqueando ir al pasado)
  const handlePrevYears = () => {
    if (yearPageStart > currentActualYear) {
      setYearPageStart((prev) => prev - 9);
    }
  };
  const handleNextYears = () => setYearPageStart((prev) => prev + 9);

  // Lógica central de validación
  const checkIsDisabled = (dateStr: string) => {
    if (dateStr < todayStr) return true; // NUNCA agendar en el pasado
    if (minDate && dateStr < minDate) return true;
    if (maxDate && dateStr > maxDate) return true;
    if (isDateDisabled && isDateDisabled(dateStr)) return true; // Validación custom (ej. vacaciones de la Dra)
    return false;
  };

  const handleConfirm = () => {
    if (internalDate) onSelectDate(internalDate);
    onClose();
  };

  const renderHeaderDate = () => {
    if (!internalDate) return "Selecciona un día";
    const d = parseDateStr(internalDate);
    if (!d) return "Selecciona un día";
    return `${SHORT_DAY_NAMES[d.getDay()]}, ${d.getDate()} de ${SHORT_MONTH_NAMES[d.getMonth()]}`;
  };

  const currentYearsGrid = Array.from(
    { length: 9 },
    (_, i) => yearPageStart + i,
  );
  // No podemos regresar la página de años si la página actual ya contiene el año en curso
  const isPrevYearsDisabled = yearPageStart <= currentActualYear;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agendar Cita"
      icon={<CalendarSearch className="w-5 h-5 text-brand-primary" />}
      hideFooter={true} // <-- MAGIA APLICADA: Adiós botón duplicado
    >
      <div className="flex flex-col select-none px-2 pb-2">
        <div className="mb-6 pb-4 border-b border-slate-100">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-primary tracking-tight">
            {renderHeaderDate()}
          </h2>
        </div>

        <div className="min-h-70">
          {viewMode === "calendar" ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    setYearPageStart(year - (year % 9));
                    setViewMode("year");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 -ml-3 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <span className="font-bold text-brand-dark text-lg capitalize">
                    {MONTH_NAMES[month]} {year}
                  </span>
                  <ChevronDown className="w-5 h-5 text-brand-gray" />
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={handlePrevMonth}
                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-6 h-6 text-brand-dark" />
                  </button>
                  <button
                    onClick={handleNextMonth}
                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-6 h-6 text-brand-dark" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAY_NAMES.map((d,i) => (
                  <div
                    key={`${d}-${i}`}
                    className="text-center text-[11px] font-bold text-brand-gray/70 uppercase"
                  >
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-2 gap-x-1">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                  <div key={`empty-${i}`} className="w-full h-10" />
                ))}

                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = formatDateObj(new Date(year, month, day));
                  const isToday = dateStr === todayStr;
                  const isSelected = internalDate === dateStr;
                  const isDayDisabled = checkIsDisabled(dateStr);

                  return (
                    <button
                      key={`day-${day}-${i}`}
                      disabled={isDayDisabled}
                      onClick={() => setInternalDate(dateStr)}
                      className={`h-10 w-full rounded-full flex items-center justify-center text-sm transition-all mx-auto max-w-10 ${
                        isSelected
                          ? "bg-brand-primary text-white font-bold shadow-md shadow-brand-primary/30 cursor-pointer"
                          : isDayDisabled
                            ? "text-slate-200 cursor-not-allowed"
                            : "text-brand-dark font-medium hover:bg-brand-light hover:text-brand-primary cursor-pointer"
                      } ${isToday && !isSelected && !isDayDisabled ? "ring-2 ring-inset ring-brand-light text-brand-primary font-bold" : ""}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col h-full animate-in fade-in duration-200">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={handlePrevYears}
                  disabled={isPrevYearsDisabled}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                    isPrevYearsDisabled
                      ? "text-slate-200 cursor-not-allowed"
                      : "hover:bg-slate-100 text-brand-dark cursor-pointer"
                  }`}
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <span className="font-bold text-brand-gray text-sm tracking-widest uppercase">
                  {currentYearsGrid[0]} - {currentYearsGrid[8]}
                </span>
                <button
                  onClick={handleNextYears}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors cursor-pointer text-brand-dark"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {currentYearsGrid.map((y) => {
                  const isCurrentYear = y === year;
                  const isYearDisabled = y < currentActualYear;

                  return (
                    <button
                      key={y}
                      ref={isCurrentYear ? currentYearRef : null}
                      disabled={isYearDisabled}
                      onClick={() => {
                        setViewDate(new Date(y, month, 1));
                        setViewMode("calendar");
                      }}
                      className={`py-4 rounded-2xl text-base font-bold transition-all ${
                        isCurrentYear && !isYearDisabled
                          ? "bg-brand-primary text-white shadow-md shadow-brand-primary/30 cursor-pointer"
                          : isYearDisabled
                            ? "bg-slate-50/50 text-slate-300 cursor-not-allowed border border-transparent"
                            : "bg-slate-50 text-brand-dark hover:bg-brand-light hover:text-brand-primary border border-slate-100 cursor-pointer"
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-slate-50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-brand-gray hover:text-brand-dark hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!internalDate}
            className="px-6 py-2.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-primary-hover rounded-xl shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
};
