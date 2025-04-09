// app/appointments/success/[patientId]/page.tsx
import { getAppointmentById } from "@/lib/actions/appointment.actions";
import SuccessContent from "@/components/SuccessContent";

interface Props {
  params: {
    patientId: string;
  };
}

const RequestSuccessPage = async ({ params }: Props) => {
  const { patientId } = await params; 
  const appointment = await getAppointmentById(patientId);

  return <SuccessContent appointment={appointment} />;
};

export default RequestSuccessPage;