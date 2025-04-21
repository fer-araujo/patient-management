import { z } from "zod";

export const LoginSchema = z.object({
  email: z
    .string({ required_error: 'El correo es requerido' })
    .trim()
    .min(5, 'El correo debe tener al menos 5 caracteres')
    .max(255, 'El correo no puede superar los 255 caracteres')
    .email('Formato de correo inválido'),

  password: z
    .string({ required_error: 'La contraseña es requerida' })
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña no puede superar los 128 caracteres')
    .refine(
      (val) => /[A-Z]/.test(val),
      'La contraseña debe contener al menos una letra mayúscula'
    )
    .refine(
      (val) => /[a-z]/.test(val),
      'La contraseña debe contener al menos una letra minúscula'
    )
    .refine(
      (val) => /\d/.test(val),
      'La contraseña debe contener al menos un número'
    )
    .refine(
      (val) => /[!@#$%^&*(),.?":{}|<>]/.test(val),
      'La contraseña debe contener al menos un carácter especial'
    ),
});

export const CreateAppointmentSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
  schedule: z.coerce.date(),
  reason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
  studyDocument: z.custom<File[]>().optional(),
  cancellationReason: z.string().optional(),
});

export const ScheduleAppointmentSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  studyDocument: z.custom<File[]>().optional(),
  cancellationReason: z.string().optional(),
});

export const CancelAppointmentSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  phone: z
    .string()
    .refine((phone) => /^\+\d{10,15}$/.test(phone), "Invalid phone number"),
  schedule: z.coerce.date(),
  reason: z.string().optional(),
  studyDocument: z.custom<File[]>().optional(),
  cancellationReason: z
    .string()
    .min(2, "Reason must be at least 2 characters")
    .max(500, "Reason must be at most 500 characters"),
});

export function getAppointmentSchema(type: string) {
  switch (type) {
    case "create":
      return CreateAppointmentSchema;
    case "cancel":
      return CancelAppointmentSchema;
    default:
      return ScheduleAppointmentSchema;
  }
}
