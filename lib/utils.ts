import { ActionMapValue, Appointment } from "@/types/appwrite.types";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const parseStringify = (value: unknown) =>
  JSON.parse(JSON.stringify(value));

export const convertFileToUrl = (file: File) => URL.createObjectURL(file);

// FORMAT DATE TIME
export const formatDateTime = (dateString: Date | string) => {
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    // weekday: "short", // abbreviated weekday name (e.g., 'Mon')
    month: "short", // abbreviated month name (e.g., 'Oct')
    day: "numeric", // numeric day of the month (e.g., '25')
    year: "numeric", // numeric year (e.g., '2023')
    hour: "numeric", // numeric hour (e.g., '8')
    minute: "numeric", // numeric minute (e.g., '30')
    hour12: true, // use 12-hour clock (true) or 24-hour clock (false)
  };

  const dateDayOptions: Intl.DateTimeFormatOptions = {
    weekday: "short", // abbreviated weekday name (e.g., 'Mon')
    year: "numeric", // numeric year (e.g., '2023')
    month: "2-digit", // abbreviated month name (e.g., 'Oct')
    day: "2-digit", // numeric day of the month (e.g., '25')
  };

  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short", // abbreviated month name (e.g., 'Oct')
    year: "numeric", // numeric year (e.g., '2023')
    day: "numeric", // numeric day of the month (e.g., '25')
  };

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric", // numeric hour (e.g., '8')
    minute: "numeric", // numeric minute (e.g., '30')
    hour12: true, // use 12-hour clock (true) or 24-hour clock (false)
  };

  const formattedDateTime: string = new Date(dateString).toLocaleString(
    "es-MX",
    dateTimeOptions
  );

  const formattedDateDay: string = new Date(dateString).toLocaleString(
    "es-MX",
    dateDayOptions
  );

  const formattedDate: string = new Date(dateString).toLocaleString(
    "es-MX",
    dateOptions
  );

  const formattedTime: string = new Date(dateString).toLocaleString(
    "es-MX",
    timeOptions
  );

  return {
    dateTime: formattedDateTime,
    dateDay: formattedDateDay,
    dateOnly: formattedDate,
    timeOnly: formattedTime,
  };
};

export const formatPhoneNumber = (phone: string): string => {
  if (!phone.startsWith("+52") || phone.length !== 13) return phone;

  const areaCode = phone.slice(3, 6);
  const middle = phone.slice(6, 9);
  const last = phone.slice(9);

  return `+52 ${areaCode} ${middle} ${last}`;
};

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .filter((n) => n.length > 0)
    .map((word) => word[0].toUpperCase())
    .slice(0, 2)
    .join("");
};

export const generateRandomColor = (): string => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

// Calcula si un color es claro u oscuro (YIQ)
export const getContrastYIQ = (hexcolor: string): "black" | "white" => {
  const r = parseInt(hexcolor.slice(1, 2), 16);
  const g = parseInt(hexcolor.slice(3, 2), 16);
  const b = parseInt(hexcolor.slice(5, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "black" : "white";
};

export const stringHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
};

// Paleta de colores de fondo y mapeo a color de texto
export const bgColors = [
  "bg-amber-200",
  "bg-lime-200",
  "bg-pink-200",
  "bg-violet-200",
  "bg-sky-200",
  "bg-green-200",
  "bg-yellow-200",
  "bg-indigo-200",
  "bg-orange-200",
  "bg-rose-200",
];

export const textColorMap: Record<string, "black" | "white"> = {
  "text-amber-200": "black",
  "text-lime-200": "black",
  "text-pink-200": "black",
  "text-violet-200": "black",
  "text-sky-200": "black",
  "text-green-200": "black",
  "text-yellow-200": "black",
  "text-indigo-200": "white",
  "text-orange-200": "black",
  "text-rose-200": "black",
};

// Mapea cada estado a las acciones correspondientes
export const actionMap: Record<Appointment["status"], ActionMapValue> = {
  pending: { primary: "Agendar", secondary: "Rechazar" },
  scheduled: { primary: "Reagendar", secondary: "Cancelar" },
  rescheduled: { primary: "Reagendar", secondary: "Cancelar" },
  cancelled: { text: "Cancelada" },
  denied: { text: "Rechazada" },
};
