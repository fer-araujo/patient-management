import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Button } from "./ui/button";
import { Download } from "lucide-react";
import Image from "next/image";

type StudyFile = {
  id: string;
};

const StudiesModal = ({
  patientName,
  studies,
}: {
  patientName: string;
  studies: StudyFile[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="capitalize text-sm font-light dark:hover:text-dark-700"
        >
          Estudios
        </Button>
      </DialogTrigger>
      <DialogContent className="shad-dialog min-auto overflow-hidden">
        <DialogHeader className="mb-4 space-y-3">
          <DialogTitle>Estudios de {patientName}</DialogTitle>
        </DialogHeader>
        {studies.length > 0 ? (
          <Carousel className="w-full flex flex-col items-center justify-center">
            <CarouselContent>
              {studies.map((study, index) => {
                const fileHandlerUrl = `/api/files/${study.id}/preview`;
                return (
                  <CarouselItem key={index}>
                    <div className="w-full h-full flex justify-center">
                      <Image
                        src={fileHandlerUrl}
                        alt={`Estudio ${index + 1}`}
                        width={500}
                        height={600}
                        className="rounded-lg object-contain max-h-[600px]"
                      />
                    </div>
                    <a
                      href={fileHandlerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="text-sm text-blue-600 hover:underline flex items-center gap-2 mt-2"
                    >
                      <Download className="w-4 h-4" /> Descargar Estudio {index + 1}
                    </a>
                  </CarouselItem>
                );
              })}
            </CarouselContent>
            <div className="flex items-center justify-around w-full mt-4">
              <CarouselPrevious className="dark:bg-dark-200 dark:hover:bg-dark-500 left-8 -translate-1/2" />
              <CarouselNext className="dark:bg-dark-200 dark:hover:bg-dark-500 right-4 -translate-1/2" />
            </div>
          </Carousel>
        ) : (
          <p className="text-muted-foreground">No hay estudios disponibles.</p>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StudiesModal;
