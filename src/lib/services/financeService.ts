import { supabase } from "../supabase";
import { combineIsoDateAndTime } from "../../features/doctor/utils/calendarUtils";

export type PaymentStatus = "paid" | "courtesy";
export type PaymentMethod = "cash" | "card" | "transfer";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

export interface Payment {
  id: string;
  appointmentId: string;
  patientId: string | null;
  serviceId: string | null;
  listPrice: number | null;
  amountCharged: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaymentRow {
  id: string;
  appointment_id: string;
  patient_id: string | null;
  service_id: string | null;
  list_price: number | string | null;
  amount_charged: number | string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordPaymentInput {
  appointmentId: string;
  status: PaymentStatus;
  /** Required (> 0) when status is "paid"; ignored for a courtesy. */
  amount?: number;
  /** Required when status is "paid"; ignored for a courtesy. */
  method?: PaymentMethod | null;
  note?: string;
}

/** PostgREST returns numeric columns as strings; null stays null. */
const toNumber = (value: number | string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

const toNullableNumber = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  appointmentId: row.appointment_id,
  patientId: row.patient_id,
  serviceId: row.service_id,
  listPrice: toNullableNumber(row.list_price),
  amountCharged: toNumber(row.amount_charged),
  status: row.status,
  method: row.method,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Failures raised on purpose by record_payment carry code P0001 and a Spanish message. */
const rpcError = (error: { code?: string; message: string }, fallback: string) =>
  new Error(error.code === "P0001" ? error.message : fallback);

/**
 * Records (or corrects) the charge of one appointment. The server fills the
 * patient, the service and its list price, and stores a courtesy as 0 with no
 * method.
 */
export const recordPayment = async (
  input: RecordPaymentInput,
): Promise<Payment> => {
  const isPaid = input.status === "paid";
  if (isPaid) {
    if (
      input.amount === undefined ||
      !Number.isFinite(input.amount) ||
      input.amount <= 0
    ) {
      throw new Error("Indica cuánto cobraste (más de 0).");
    }
    if (!input.method) {
      throw new Error("Indica cómo te pagaron.");
    }
  }

  const { data, error } = await supabase.rpc("record_payment", {
    p_appointment_id: input.appointmentId,
    p_status: input.status,
    p_amount: isPaid ? input.amount : 0,
    p_method: isPaid ? input.method : null,
    p_note: input.note?.trim() || null,
  });

  if (error) {
    console.error("[FinanceService] record_payment failed:", error.code);
    throw rpcError(error, "No se pudo guardar el cobro.");
  }
  return toPayment(data as PaymentRow);
};

/** The charge recorded for an appointment, or null when there is none yet. */
export const fetchPayment = async (
  appointmentId: string,
): Promise<Payment | null> => {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching payment:", error);
    throw new Error("No se pudo cargar el cobro.");
  }
  return data ? toPayment(data as PaymentRow) : null;
};

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

export type FinancePeriod = "this_month" | "last_month" | "this_year";

/** Calendar dates (YYYY-MM-DD) in clinic time: `from` inclusive, `to` exclusive. */
export interface DateRange {
  from: string;
  to: string;
}

export type MovementKind = "payment" | "courtesy" | "purchase";

export interface FinanceMovement {
  id: string;
  kind: MovementKind;
  date: string;
  concept: string;
  /** Signed: + money in, − money out, 0 for a courtesy. */
  amount: number;
}

export interface MonthlyFinance {
  /** "YYYY-MM" */
  month: string;
  income: number;
  /** List price of the courtesies given that month (value not charged). */
  courtesy: number;
  expenses: number;
}

export interface ServiceIncome {
  service: string;
  total: number;
  count: number;
}

export interface FinanceSummary {
  income: number;
  expenses: number;
  profit: number;
  courtesyCount: number;
  /** Sum of the list price of the courtesies in the range. */
  forgoneValue: number;
  incomeByService: ServiceIncome[];
  monthly: MonthlyFinance[];
  movements: FinanceMovement[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const toIsoDate = (year: number, monthIndex: number, day = 1): string => {
  // Normalizes overflow (month 12 -> January of the next year, month -1 -> December).
  const d = new Date(year, monthIndex, day);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** The date range of a period, relative to `now` (clinic time). */
export const getPeriodRange = (
  period: FinancePeriod,
  now: Date = new Date(),
): DateRange => {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "this_month") {
    return { from: toIsoDate(y, m), to: toIsoDate(y, m + 1) };
  }
  if (period === "last_month") {
    return { from: toIsoDate(y, m - 1), to: toIsoDate(y, m) };
  }
  return { from: toIsoDate(y, 0), to: toIsoDate(y + 1, 0) };
};

/** Start of a clinic-time calendar day as a UTC instant, via the calendar helper. */
const dayStartUtc = (isoDate: string): string =>
  combineIsoDateAndTime(isoDate, "12:00 AM");

/** "YYYY-MM" of an instant, in clinic time. */
export const monthKeyOf = (timestamp: string): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

/** "2026-09" -> { label: "sep", fullLabel: "Septiembre de 2026" } (es-MX). */
export const monthLabels = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  const full = date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return {
    label: date.toLocaleDateString("es-MX", { month: "short" }).replace(/\./g, ""),
    fullLabel: full.charAt(0).toUpperCase() + full.slice(1),
  };
};

/** Every "YYYY-MM" from the month of `from` up to (excluding) `to`. */
const monthsInRange = ({ from, to }: DateRange): string[] => {
  const [fy, fm] = from.split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; ; i++) {
    const start = toIsoDate(fy, fm - 1 + i);
    if (start >= to) break;
    months.push(start.slice(0, 7));
  }
  return months;
};

interface PaymentSummaryRow {
  id: string;
  status: PaymentStatus;
  amount_charged: number | string;
  list_price: number | string | null;
  created_at: string;
  services: { name: string | null } | null;
  /** Only requested for the doctor; absent (or null under RLS) for an admin. */
  patients?: { first_name: string | null; last_name: string | null } | null;
}

export interface FinanceSummaryOptions {
  /**
   * Adds the patient's name to each payment's concept. Only the doctor may see
   * it: tying "Hilos Tensores · $5,500" to a person is health data. Off by
   * default, so an admin view never even asks for it (and RLS would return no
   * patient anyway).
   */
  includePatientNames?: boolean;
}

const PAYMENT_COLUMNS =
  "id, status, amount_charged, list_price, created_at, services ( name )";

interface PurchaseRow {
  id: string;
  quantity: number;
  total_cost: number | string | null;
  created_at: string;
  inventory: { name: string | null } | null;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/**
 * Income, supply spending and courtesies between two clinic-time dates
 * (`from` inclusive, `to` exclusive). Payments count on the day they were
 * recorded; expenses are the inventory purchases of the same range.
 */
export const getFinanceSummary = async (
  from: string,
  to: string,
  { includePatientNames = false }: FinanceSummaryOptions = {},
): Promise<FinanceSummary> => {
  const fromUtc = dayStartUtc(from);
  const toUtc = dayStartUtc(to);

  const [paymentsRes, purchasesRes] = await Promise.all([
    supabase
      .from("payments")
      .select(
        includePatientNames
          ? `${PAYMENT_COLUMNS}, patients ( first_name, last_name )`
          : PAYMENT_COLUMNS,
      )
      .gte("created_at", fromUtc)
      .lt("created_at", toUtc)
      .order("created_at", { ascending: false })
      .returns<PaymentSummaryRow[]>(),
    supabase
      .from("inventory_movements")
      .select("id, quantity, total_cost, created_at, inventory ( name )")
      .eq("type", "purchase")
      .gte("created_at", fromUtc)
      .lt("created_at", toUtc)
      .order("created_at", { ascending: false })
      .returns<PurchaseRow[]>(),
  ]);

  if (paymentsRes.error || purchasesRes.error) {
    console.error(
      "Error fetching finance data:",
      paymentsRes.error ?? purchasesRes.error,
    );
    throw new Error("No se pudieron cargar las finanzas.");
  }

  const payments = paymentsRes.data ?? [];
  const purchases = purchasesRes.data ?? [];

  const monthly = new Map<string, MonthlyFinance>(
    monthsInRange({ from, to }).map((month) => [
      month,
      { month, income: 0, courtesy: 0, expenses: 0 },
    ]),
  );
  const byService = new Map<string, ServiceIncome>();
  const movements: FinanceMovement[] = [];

  let income = 0;
  let expenses = 0;
  let courtesyCount = 0;
  let forgoneValue = 0;

  for (const p of payments) {
    const service = p.services?.name || "Servicio eliminado";
    const patient = includePatientNames
      ? [p.patients?.first_name, p.patients?.last_name].filter(Boolean).join(" ")
      : "";
    const concept = patient ? `${service} · ${patient}` : service;

    if (p.status === "courtesy") {
      // A courtesy is value NOT charged, never an expense: it is reported on
      // its own and does not change the profit.
      const listPrice = toNumber(p.list_price);
      courtesyCount += 1;
      forgoneValue += listPrice;
      const courtesyBucket = monthly.get(monthKeyOf(p.created_at));
      if (courtesyBucket) courtesyBucket.courtesy += listPrice;
      movements.push({
        id: p.id,
        kind: "courtesy",
        date: p.created_at,
        concept,
        amount: 0,
      });
      continue;
    }

    const amount = toNumber(p.amount_charged);
    income += amount;
    const bucket = monthly.get(monthKeyOf(p.created_at));
    if (bucket) bucket.income += amount;

    const entry = byService.get(service) ?? { service, total: 0, count: 0 };
    entry.total += amount;
    entry.count += 1;
    byService.set(service, entry);

    movements.push({ id: p.id, kind: "payment", date: p.created_at, concept, amount });
  }

  for (const m of purchases) {
    const cost = toNumber(m.total_cost);
    expenses += cost;
    const bucket = monthly.get(monthKeyOf(m.created_at));
    if (bucket) bucket.expenses += cost;
    movements.push({
      id: m.id,
      kind: "purchase",
      date: m.created_at,
      concept: `${m.inventory?.name || "Insumo"} (${m.quantity})`,
      amount: -cost,
    });
  }

  movements.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return {
    income: roundCents(income),
    expenses: roundCents(expenses),
    profit: roundCents(income - expenses),
    courtesyCount,
    forgoneValue: roundCents(forgoneValue),
    incomeByService: [...byService.values()]
      .map((s) => ({ ...s, total: roundCents(s.total) }))
      .sort((a, b) => b.total - a.total),
    monthly: [...monthly.values()].map((b) => ({
      ...b,
      income: roundCents(b.income),
      courtesy: roundCents(b.courtesy),
      expenses: roundCents(b.expenses),
    })),
    movements,
  };
};

// -----------------------------------------------------------------------------
// Profit per procedure
// -----------------------------------------------------------------------------

export interface ProcedureProfit {
  serviceId: string | null;
  service: string;
  /** Consultations recorded in the range (paid and courtesies). */
  times: number;
  /** Money actually charged. */
  charged: number;
  /** List price of the courtesies (value not charged). */
  courtesyValue: number;
  /** Cost of the supplies used on those consultations. */
  suppliesCost: number;
  /** Supplies used with no registered cost (never purchased). */
  uncostedSupplies: number;
  /** Charged minus supplies. Courtesies never reduce it. */
  profit: number;
  /**
   * Finalized consultations whose supplies were never recorded (service with
   * supplies configured): their supply cost is missing from this row.
   */
  unrecordedConsultations: number;
}

export interface ProcedureProfitSummary {
  rows: ProcedureProfit[];
  total: Omit<ProcedureProfit, "serviceId" | "service">;
  /** True when some supply had no cost, so its procedure looks cheaper. */
  hasUncostedSupplies: boolean;
}

interface ProcedureProfitRow {
  service_id: string | null;
  service_name: string | null;
  times: number | string;
  charged: number | string | null;
  courtesy_value: number | string | null;
  supplies_cost: number | string | null;
  uncosted_supplies: number | string | null;
  profit: number | string | null;
  unrecorded_consultations?: number | string | null;
}

/**
 * Charged vs. supply cost per service for the payments recorded between two
 * clinic-time dates (`from` inclusive, `to` exclusive), the same rule as the
 * cash view. The server does the join (get_procedure_profit, migration 22);
 * it returns no patient data, so the admin can see it too.
 */
export const getProcedureProfit = async (
  from: string,
  to: string,
): Promise<ProcedureProfitSummary> => {
  const { data, error } = await supabase.rpc("get_procedure_profit", {
    p_from: dayStartUtc(from),
    p_to: dayStartUtc(to),
  });

  if (error) {
    console.error("[FinanceService] get_procedure_profit failed:", error.code);
    throw new Error("No se pudo cargar la ganancia por procedimiento.");
  }

  const rows = ((data ?? []) as ProcedureProfitRow[]).map((r) => {
    const charged = roundCents(toNumber(r.charged));
    const suppliesCost = roundCents(toNumber(r.supplies_cost));
    return {
      serviceId: r.service_id,
      service: r.service_name || "Sin servicio",
      times: toNumber(r.times),
      charged,
      courtesyValue: roundCents(toNumber(r.courtesy_value)),
      suppliesCost,
      uncostedSupplies: toNumber(r.uncosted_supplies),
      profit: roundCents(charged - suppliesCost),
      unrecordedConsultations: toNumber(r.unrecorded_consultations),
    };
  });

  const sum = (pick: (r: ProcedureProfit) => number) =>
    roundCents(rows.reduce((acc, r) => acc + pick(r), 0));
  const charged = sum((r) => r.charged);
  const suppliesCost = sum((r) => r.suppliesCost);
  const uncostedSupplies = rows.reduce((acc, r) => acc + r.uncostedSupplies, 0);

  return {
    rows,
    total: {
      times: rows.reduce((acc, r) => acc + r.times, 0),
      charged,
      courtesyValue: sum((r) => r.courtesyValue),
      suppliesCost,
      uncostedSupplies,
      profit: roundCents(charged - suppliesCost),
      unrecordedConsultations: rows.reduce(
        (acc, r) => acc + r.unrecordedConsultations,
        0,
      ),
    },
    hasUncostedSupplies: uncostedSupplies > 0,
  };
};
