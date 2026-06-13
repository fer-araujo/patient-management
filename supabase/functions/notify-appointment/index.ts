import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  record: {
    id: string;
    patient_id: string;
    service_id: string;
    start_time: string;
    status: string;
    updated_by?: string; // <-- AÑADIDO PARA LA HUELLA DIGITAL
    [key: string]: unknown;
  };
  old_record?: {
    start_time: string;
    status: string;
    [key: string]: unknown;
  };
}

serve(async (req: Request) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;
    const oldRecord = payload.old_record;

    const isReschedule =
      payload.type === "UPDATE" &&
      oldRecord &&
      oldRecord.start_time !== record.start_time;

    if (
      payload.type === "UPDATE" &&
      !["confirmed", "cancelled"].includes(record.status) &&
      !isReschedule
    ) {
      console.log(`Status update to ${record.status} ignored. No time change.`);
      return new Response("No notification needed.", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: patient } = await supabase
      .from("patients")
      .select("first_name, phone")
      .eq("id", record.patient_id)
      .single();

    const { data: service } = await supabase
      .from("services")
      .select("name")
      .eq("id", record.service_id)
      .single();

    if (!patient || !patient.phone) {
      throw new Error("No se encontró el teléfono del paciente.");
    }

    let targetPhone = patient.phone;
    if (targetPhone.startsWith("+52") && targetPhone.length === 13) {
      targetPhone = targetPhone.replace("+52", "+521");
    }

    const dateObj = new Date(record.start_time);
    const formattedDate = dateObj.toLocaleDateString("es-MX", {
      timeZone: "America/Mexico_City",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const formattedTime = dateObj.toLocaleTimeString("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // =========================================================
    // LÓGICA BIFURCADA (NUEVA)
    // =========================================================
    let messageBody = "";
    const updatedBy = record.updated_by || "doctor"; // Asumimos doctor por defecto si no hay dato

    if (payload.type === "INSERT") {
      messageBody = `¡Hola ${patient.first_name}! 👋\n\nTu solicitud de cita para *${service?.name}* el *${formattedDate}* a las *${formattedTime}* ha sido recibida y está pendiente de confirmación por la doctora.\n\nTe avisaremos en breve.\n\n_Atte: Clínica Torres_ 🏥`;
    } else if (payload.type === "UPDATE" && record.status === "cancelled") {
      if (updatedBy === "patient") {
        messageBody = `¡Hola ${patient.first_name}! ❌\n\nConfirmamos que has CANCELADO tu cita para *${service?.name}* del *${formattedDate}*.\n\nPuedes reagendar cuando gustes desde tu portal.\n\n_Atte: Clínica Torres_`;
      } else {
        messageBody = `¡Hola ${patient.first_name}! ❌\n\nLamentamos informarte que la Dra. Carmen ha tenido que CANCELAR tu cita para *${service?.name}*.\n\nPor favor entra a tu portal para elegir un nuevo día que te convenga.\n\n_Atte: Clínica Torres_`;
      }
    } else if (isReschedule) {
      if (updatedBy === "patient") {
        messageBody = `¡Hola ${patient.first_name}! 📅\n\nConfirmamos que has REPROGRAMADO tu cita para *${service?.name}* exitosamente.\n\nNueva fecha: *${formattedDate}* a las *${formattedTime}*.\n\n¡Te esperamos! ✨\n\n_Atte: Clínica Torres_`;
      } else {
        messageBody = `¡Hola ${patient.first_name}! 📅\n\nLa Dra. Carmen ha REPROGRAMADO tu cita para *${service?.name}*.\n\nNueva fecha: *${formattedDate}* a las *${formattedTime}*.\n\n*Si este nuevo horario no te funciona*, por favor entra a tu portal para elegir otro día o cancelar la cita.\n\n_Atte: Clínica Torres_`;
      }
    } else if (payload.type === "UPDATE" && record.status === "confirmed") {
      messageBody = `¡Hola ${patient.first_name}! ✅\n\nTu cita para *${service?.name}* el *${formattedDate}* a las *${formattedTime}* ha sido CONFIRMADA.\n\nSi necesitas contactar a la Dra. Carmen, escríbele a su número directo.\n\n¡Te esperamos! ✨`;
    } else {
      return new Response("Event ignored.", { status: 200 });
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      To: `whatsapp:${targetPhone}`,
      From: twilioPhoneNumber!,
      Body: messageBody,
    });

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
      },
      body: twilioBody.toString(),
    });

    const twilioResult = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("TWILIO RECHAZÓ EL MENSAJE:", twilioResult);
    } else {
      console.log("Mensaje enviado con éxito vía Twilio.");
    }

    return new Response(JSON.stringify(twilioResult), {
      status: twilioResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error crítico en la Edge Function:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido.";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
    });
  }
});
