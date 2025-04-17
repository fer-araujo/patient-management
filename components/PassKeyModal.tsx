"use client";

import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useRouter } from "next/navigation";

const PassKeyModal: React.FC = () => {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [passKey, setPassKey] = useState("");
  const [error, setError] = useState("");

  const validatePassKey = async () => {
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passKey }),
    });

    if (res.ok) {
      setOpen(false);
      router.push("/admin");
    } else {
      setError("Clave de administrador incorrecta.");
    }
  };

  const closeModal = () => {
    setOpen(false);
    router.push("/");
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="shad-alert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex justify-between items-center">
            Verificación de Administrador
            <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
              &times;
            </button>
          </AlertDialogTitle>
          <AlertDialogDescription>
            Ingresa la clave de acceso para continuar.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="mt-4">
          <InputOTP
            maxLength={6}
            value={passKey}
            onChange={(value) => setPassKey(value)}
          >
            <InputOTPGroup className="w-full flex justify-between">
              {[...Array(6)].map((_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="text-4xl font-bold flex justify-center items-center border border-gray-300 rounded-lg w-16 h-16"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction
            onClick={validatePassKey}
            className="shad-primary-btn w-full"
          >
            Ingresar Código
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default PassKeyModal;
