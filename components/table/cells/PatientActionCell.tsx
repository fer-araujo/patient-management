import { Button } from "@/components/ui/button";
import { Patient } from "@/types/appwrite.types";

const PatientActionCell = ({ patient }: { patient: Patient }) => {
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        className="capitalize text-white hover:text-gray-500"
        onClick={() => console.log("Schedule appointment for", patient.name)}
      >
        Agendar
      </Button>
      <Button
        variant="ghost"
        className="capitalize text-green-500"
        onClick={() => console.log("Edit patient", patient.name)}
      >
        Editar
      </Button>
    </div>
  );
};

export default PatientActionCell;