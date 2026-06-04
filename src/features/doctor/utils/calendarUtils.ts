import type { DashboardAppointment } from "../../../lib/services/clinicService";
import type { DashboardBlockedSlot } from "../../../lib/services/blockedSlotsService";
import type { WeeklySchedule } from "../../../lib/services/settingsService";

export const HOUR_HEIGHT = 100;

export const extractHoursMinutes = (timeStr: string): { hours: number; minutes: number } => {
  const clean = timeStr.toLowerCase().replace(/\./g, "").replace(/\s/g, ""); 
  const isPM = clean.includes("p");
  const isAM = clean.includes("a");
  const timePart = clean.replace(/[a-z]/g, ""); 
  let [hours, minutes] = timePart.split(":").map(Number);
  if (isNaN(minutes)) minutes = 0;
  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  return { hours, minutes };
};

export const parseHour24 = (timeStr: string): number => extractHoursMinutes(timeStr).hours;

export const timeToDecimal = (timeStr: string): number => {
  const { hours, minutes } = extractHoursMinutes(timeStr);
  return hours + (minutes / 60);
};

export const timeToPixels = (timeStr: string, startHour: number): number => {
  const { hours, minutes } = extractHoursMinutes(timeStr);
  const offsetMinutes = (hours * 60 + minutes) - (startHour * 60);
  return (offsetMinutes / 60) * HOUR_HEIGHT;
};

export const getServiceColors = (service: string, isPast: boolean): string => {
  let colors = "bg-amber-50 border-amber-400 text-amber-700";
  
  if (service.includes("Toxina")) colors = "bg-blue-50 border-blue-500 text-blue-700";
  else if (service.includes("Hilos")) colors = "bg-emerald-50 border-emerald-500 text-emerald-700";
  else if (service.includes("Plasma")) colors = "bg-rose-50 border-rose-400 text-rose-700";
  else if (service.includes("Valoración")) colors = "bg-indigo-50 border-indigo-400 text-indigo-700"; 

  return isPast ? `${colors} opacity-60` : colors;
};

export const isTimeSlotInPast = (dateObj: Date, hour24: number): boolean => {
  const now = new Date();
  const currentHour = now.getHours();
  const targetMidnight = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (targetMidnight < todayMidnight) return true; 
  if (targetMidnight.getTime() === todayMidnight.getTime() && hour24 <= currentHour) return true; 
  return false;
};

export const parseVisualDateToISO = (visualDate: string): string => {
  const [day, monthStr, year] = visualDate.toLowerCase().split(" ");
  const months: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  return `${year}-${months[monthStr] || "01"}-${day.padStart(2, "0")}`;
};

export const combineIsoDateAndTime = (isoDate: string, timeStr: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const { hours, minutes } = extractHoursMinutes(timeStr);
  const localDate = new Date(year, month - 1, day, hours, minutes);
  return localDate.toISOString(); 
};

export const combineVisualDateAndTime = (visualDate: string, timeStr: string): string => {
  return combineIsoDateAndTime(parseVisualDateToISO(visualDate), timeStr);
};

// AHORA RECIBE WeeklySchedule ESTRICTO
export const getGridHoursRange = (schedule: WeeklySchedule): { start: number; end: number } => {
  let min = 24, max = 0;
  Object.values(schedule).forEach((day) => {
    if (day.isOpen) {
      const s = parseHour24(day.start);
      const e = parseHour24(day.end);
      if (s < min) min = s;
      if (e > max) max = e;
    }
  });
  if (min >= max) return { start: 8, end: 18 }; 
  return { start: min, end: max };
};

// TIPADO ESTRICTO EN TODOS LOS PARÁMETROS
export const getAvailableTimeOptions = (
  isoDate: string,
  appointments: DashboardAppointment[],
  blockedSlots: DashboardBlockedSlot[],
  workingSchedule: WeeklySchedule,
  requiredDurationMins: number = 30
): { label: string; value: string }[] => {
  if (!isoDate) return [];
  const [y, m, d] = isoDate.split("-").map(Number);
  const targetDateObj = new Date(y, m - 1, d);
  
  const daySchedule = workingSchedule[targetDateObj.getDay() as keyof WeeklySchedule];
  if (!daySchedule || !daySchedule.isOpen) return []; 

  const startDec = timeToDecimal(daySchedule.start);
  const endDec = timeToDecimal(daySchedule.end);
  const options: string[] = [];

  for (let h = Math.floor(startDec); h < endDec; h++) {
    for (const mins of [0, 15, 30, 45]) {
      const currentDec = h + (mins / 60);
      if (currentDec >= startDec && currentDec < endDec) {
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
        options.push(`${String(h12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${ampm}`);
      }
    }
  }

  const visualDateStr = targetDateObj.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "").toLowerCase();
  const appsToday = appointments.filter(a => a.date.toLowerCase() === visualDateStr && a.status === "confirmed");
  const blocksToday = blockedSlots.filter(b => b.date.toLowerCase() === visualDateStr);

  return options.filter(timeStr => {
    const slotStart = timeToDecimal(timeStr);
    const slotEnd = slotStart + (requiredDurationMins / 60); 
    if (slotEnd > endDec) return false; 

    const colisionCita = appsToday.some(app => {
       const appStart = timeToDecimal(app.time);
       const appEnd = appStart + (app.durationMins / 60);
       return slotStart < appEnd && slotEnd > appStart;
    });

    const colisionBloqueo = blocksToday.some(b => {
       const blockStart = timeToDecimal(b.startTime);
       const blockEnd = blockStart + (b.durationMins / 60);
       return slotStart < blockEnd && slotEnd > blockStart;
    });

    return !colisionCita && !colisionBloqueo;
  }).map(t => ({ label: t, value: t }));
};