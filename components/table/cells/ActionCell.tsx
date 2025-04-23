import AppointmentModal from '@/components/AppointmentModal';
import { actionMap } from '@/lib/utils';
import { ActionMapValue, Appointment } from '@/types/appwrite.types';
import { FC, useMemo } from 'react'

const ActionCell: FC<{ status: Appointment["status"]; appointment: Appointment }> = ({ status, appointment }) => {
    const actions = useMemo(() => actionMap[status], [status]);
  
    // Si solo es texto, mostrar parágrafo
    if ("text" in actions) {
      return <p className="ml-4 inline-flex items-center justify-center whitespace-nowrap text-sm font-medium text-red-500">{actions.text}</p>;
    }
  
    // Si es par de acciones, mostrar botones
    return (
      <div className="flex gap-1">
        <AppointmentModal type={actions.primary as unknown as ActionMapValue} appointment={appointment} />
        {actions.secondary && (
          <AppointmentModal type={actions.secondary as unknown as ActionMapValue} appointment={appointment} />
        )}
      </div>
    );
  };
  
export default ActionCell