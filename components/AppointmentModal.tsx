import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "./ui/button";
import { AppointmentForm } from "./forms/AppointmentForm";
import { ActionMapValue, Appointment } from "@/types/appwrite.types";
import clsx from "clsx";

const AppointmentModal = ({
  type,
  appointment,
}: {
  type: ActionMapValue;
  appointment?: Appointment;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={clsx("capitalize", {
                  "text-green-500": type.toString() === "Agendar",
                  "text-blue-500": type.toString() === "Reagendar",
                  "text-white hover:text-gray-500": type.toString() === "Cancelar" || type.toString() === "Rechazar",
                })}
        >
          {type.toString()}
        </Button>
      </DialogTrigger>
      <DialogContent className="shad-dialog sm:max-w-md">
        <DialogHeader className="mb-4 space-y-3">
          <DialogTitle className="capitalize">{type.toString()} Cita</DialogTitle>
          <DialogDescription>
            Favor de validar o llenar los campos requeridos para {type.toString().toLowerCase()} la
            cita.
          </DialogDescription>
        </DialogHeader>

        <AppointmentForm type={type.toString()} appointment={appointment} setOpen={setOpen}/>
      </DialogContent>
    </Dialog>
  );
};

export default AppointmentModal;
