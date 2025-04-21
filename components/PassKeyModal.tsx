// File: components/PassKeyModal.tsx
"use client";

import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRouter, useSearchParams } from "next/navigation";
import CustomFormField, { FormFieldType } from "./CustomFormField";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithEmail } from "@/lib/actions/auth.actions";
import { LoginSchema } from "@/lib/validation";
import { Form } from "./ui/form";

export default function PassKeyModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(true);

  // Leer parámetro redirect de la URL (?redirect=admin)
  const redirect = searchParams.get("redirect") || "admin";

  type LoginInput = {
    email: string;
    password: string;
  };
  // RHF + Zod
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Submit vía fetch y luego router.push
  const onSubmit = async (data: LoginInput) => {
    try {
      await signInWithEmail(data.email, data.password);
      setOpen(false);
      router.push(`/${redirect}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        form.setError("root", {
          message: err.message || "Error de autenticación",
        });
      } else {
        form.setError("root", { message: "Error de autenticación" });
      }
    }
  };

  const closeModal = () => {
    setOpen(false);
    router.push("/");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(val) => {
        if (!val) closeModal();
        setOpen(val);
      }}
    >
      <AlertDialogContent className="shad-alert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex justify-between items-center">
            Verificación de Administrador
            <button
              onClick={closeModal}
              className="text-gray-500 hover:text-gray-700"
            >
              &times;
            </button>
          </AlertDialogTitle>
        </AlertDialogHeader>
        <Form {...form}>
          <div className="space-y-8 flex flex-col px-4">
            <CustomFormField
              fieldType={FormFieldType.INPUT}
              control={form.control}
              name="email"
              label="Correo Electrónico"
              placeholder="correo@ejemplo.com"
              iconSrc="/assets/icons/user.svg"
            />
            <CustomFormField
              fieldType={FormFieldType.PASSWORD}
              control={form.control}
              name="password"
              label="Contraseña"
              placeholder="********"
            />

            {form.formState.errors.root && (
              <p className="text-red-500">
                {form.formState.errors.root.message}
              </p>
            )}

            <AlertDialogFooter className="flex flex-col gap-2">
              <AlertDialogAction
                onClick={form.handleSubmit(onSubmit)}
                className="shad-primary-btn w-full"
              >
                Iniciar Sesión
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
