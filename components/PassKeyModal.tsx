"use client";

import React, { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { getAdminPassKey } from "@/lib/actions/admin.actions";
import { decryptKey, encryptKey } from "@/lib/utils";

const PassKeyModal = () => {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const [passKey, setPassKey] = useState("");
  const [error, setError] = useState("");

  const encryptedPassKey = typeof window !== "undefined" ? window.localStorage.getItem("accessKey") : null;
  
  useEffect(() => {
    async function fetchPassKey() {
      const storedPassKey = await getAdminPassKey();
      const accessKey = encryptedPassKey && decryptKey(encryptedPassKey);
      if (path) {
        if (accessKey === storedPassKey) {
          setOpen(false);
          router.push("/admin");
        }
      }
    }
    fetchPassKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  

  const validatePassKey = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    const storedPassKey = await getAdminPassKey();

    if (passKey === storedPassKey) {
      const encrypted = encryptKey(passKey);
      localStorage.setItem("accessKey", encrypted);

      setOpen(false);
      router.push("/admin");
    } else {
      setError("La clave de acceso es incorrecta. Por favor intente de nuevo.");
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
          <AlertDialogTitle className="flex items-start justify-between">
            Verificacion de Administrador
            <Image
              src={"/assets/icons/close.svg"}
              alt="close"
              width={20}
              height={20}
              onClick={() => closeModal()}
              className="cursor-pointer"
            />
          </AlertDialogTitle>
          <AlertDialogDescription>
            Para acceder al panel de administrador por favor ingrese la clave de
            acceso.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <InputOTP
            maxLength={6}
            value={passKey}
            onChange={(value) => setPassKey(value)}
          >
            <InputOTPGroup className="w-full flex justify-between">
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={0}
              />
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={1}
              />
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={2}
              />
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={3}
              />
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={4}
              />
              <InputOTPSlot
                className="text-4xl font-bold justify-center flex border border-dark-500 rounded-lg size-16 gap-4"
                index={5}
              />
            </InputOTPGroup>
          </InputOTP>
          {error && (
            <p className="shad-error text-sm mt-4 p-2 flex justify-center ">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogAction
            className="shad-primary-btn w-full"
            onClick={(e) => validatePassKey(e)}
          >
            Ingresar Codigo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default PassKeyModal;
