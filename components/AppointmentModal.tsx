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
import { Appointment } from "@/types/appwrite.types";

const AppointmentModal = ({
  type,
  appointment,
}: {
  type: "Agendar" | "Cancelar";
  appointment?: Appointment;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={`capitalize ${type === "Agendar" && "text-green-500 dark:hover:text-green-700"} ${type === "Cancelar" && "dark:hover:text-dark-700"}`}
        >
          {type}
        </Button>
      </DialogTrigger>
      <DialogContent className="shad-dialog sm:max-w-md">
        <DialogHeader className="mb-4 space-y-3">
          <DialogTitle className="capitalize">{type} Cita</DialogTitle>
          <DialogDescription>
            Favor de validar o llenar los campos requeridos para {type.toLowerCase()} la
            cita.
          </DialogDescription>
        </DialogHeader>

        <AppointmentForm type={type} appointment={appointment} setOpen={setOpen}/>
      </DialogContent>
    </Dialog>
  );
};

export default AppointmentModal;
