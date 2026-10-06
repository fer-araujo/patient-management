import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
const webhookSecret = Deno.env.get("WEBHOOK_SECRET");

const CLINIC_NAME = "Clínica Torres";

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  record: {
    id: string;
    patient_id: string;
    start_time: string;
    status: string;
    updated_by?: string;
    [key: string]: unknown;
  };
  old_record?: {
    start_time: string;
    status: string;
    [key: string]: unknown;
  };
}

/**
 * Compares two secrets without leaking their contents through timing.
 * Both values are hashed first so the comparison always runs over a fixed
 * 32-byte buffer and the length of the supplied secret is not observable.
 */
const constantTimeEquals = async (a: string, b: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);

  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) {
    difference |= bytesA[i] ^ bytesB[i];
  }
  return difference === 0;
};

serve(async (req: Request) => {
  // ---------------------------------------------------------------------------
  // Authentication. This function is invoked by a database trigger, never by a
  // browser, so the only accepted credential is the shared secret header set on
  // the whatsapp_notifications trigger.
  // ---------------------------------------------------------------------------
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET is not configured. Refusing all requests.");
    return new Response(JSON.stringify({ error: "Not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const providedSecret = req.headers.get("x-webhook-secret") ?? "";
  if (!(await constantTimeEquals(providedSecret, webhookSecret))) {
    console.warn("Rejected request with missing or invalid webhook secret.");
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let appointmentId = "unknown";

  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;
    const oldRecord = payload.old_record;
    appointmentId = record?.id ?? "unknown";

    const isReschedule =
      payload.type === "UPDATE" &&
      !!oldRecord &&
      oldRecord.start_time !== record.start_time;

    if (
      payload.type === "UPDATE" &&
      !["confirmed", "cancelled"].includes(record.status) &&
      !isReschedule
    ) {
      console.log(`Appointment ${appointmentId}: no notification needed.`);
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // "Modo solo doctora" (migration 23): no portal, so the messages never ask
    // the patient to sign in, confirm or accept anything. If the mode cannot
    // be read, the doctor-only WORDING is used (it is true in both modes,
    // while a portal link could point at a portal that is closed), but no
    // message is skipped: the pending notice does not mention the portal, and
    // a 500 would make the webhook retry and could send the other messages
    // twice. Skipping happens only when the mode is known to be on.
    const { data: clinicMode, error: clinicModeError } = await supabase.rpc(
      "get_clinic_mode",
    );
    if (clinicModeError) {
      console.error(
        `Appointment ${appointmentId}: could not read the clinic mode (${clinicModeError.code ?? "unknown"}); using doctor-only wording, skipping nothing.`,
      );
    }
    const doctorOnlyModeKnown = !clinicModeError && clinicMode === true;
    const doctorOnlyMode = clinicModeError ? true : doctorOnlyModeKnown;

    // A request "pending confirmation" only exists with online booking.
    if (doctorOnlyModeKnown && payload.type === "INSERT" && record.status !== "confirmed") {
      console.log(`Appointment ${appointmentId}: doctor-only mode, no pending notice.`);
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: patient } = await supabase
      .from("patients")
      .select("first_name, phone")
      .eq("id", record.patient_id)
      .single();

    if (!patient || !patient.phone) {
      console.error(`Appointment ${appointmentId}: patient has no phone.`);
      return new Response(JSON.stringify({ error: "Missing recipient." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Mexican mobile numbers need the legacy '1' for WhatsApp delivery.
    //
    // DIVERGENCE RISK: this is a second, independent implementation of the same
    // rule that public.normalize_phone() / public.format_phone_e164() apply in
    // the database (see supabase/migrations/20260922180100_role_helpers.sql).
    // The database canonicalizes '+521XXXXXXXXXX' DOWN to '+52XXXXXXXXXX'; this
    // rewrites it back UP for Twilio. The two must stay mirror images: if the
    // normalization rule in SQL ever changes (a new country code, a different
    // mobile prefix, a stricter length check), this block has to change with
    // it or numbers will silently be addressed in a format WhatsApp rejects.
    // There is no shared module because this runs in Deno on the edge and that
    // one runs in Postgres; the only link is this comment.
    // Cross-check: supabase/migrations/audit/phone_normalization_check.sql
    // lists every stored phone that does not fit the assumed shape.
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

    // -------------------------------------------------------------------------
    // Message bodies.
    //
    // The treatment / service name is deliberately absent: it is health data,
    // and WhatsApp previews render on a lock screen that anyone standing near
    // the patient can read. Date, time and first name are enough for the
    // patient to recognize which appointment this is about.
    // -------------------------------------------------------------------------
    const firstName = patient.first_name || "paciente";
    const updatedBy = record.updated_by || "doctor";
    let messageBody = "";

    // Doctor-only mode: what to do instead of opening the portal.
    const CHANGE_HINT = `Si necesitas cambiarla, comunícate con la clínica.\n\n`;
    const REBOOK_HINT = `Para agendar otra cita, comunícate con la clínica.\n\n`;

    if (payload.type === "INSERT" && record.status === "confirmed") {
      // Booked by the clinic from the calendar: it is born confirmed, so no
      // later UPDATE will send the confirmation.
      messageBody =
        `¡Hola ${firstName}! ✅\n\n` +
        `Tu cita del *${formattedDate}* a las *${formattedTime}* quedó AGENDADA y CONFIRMADA.\n\n` +
        (doctorOnlyMode
          ? CHANGE_HINT
          : `*Si este horario no te funciona*, entra a tu portal para reprogramarla o cancelarla.\n\n`) +
        `_Atte: ${CLINIC_NAME}_ 🏥`;
    } else if (payload.type === "INSERT") {
      messageBody =
        `¡Hola ${firstName}! 👋\n\n` +
        `Recibimos tu solicitud de cita para el *${formattedDate}* a las *${formattedTime}*. ` +
        `Está pendiente de confirmación por la doctora.\n\nTe avisaremos en breve.\n\n` +
        `_Atte: ${CLINIC_NAME}_ 🏥`;
    } else if (payload.type === "UPDATE" && record.status === "cancelled") {
      messageBody =
        updatedBy === "patient"
          ? `¡Hola ${firstName}! ❌\n\n` +
            `Confirmamos que has CANCELADO tu cita del *${formattedDate}* a las *${formattedTime}*.\n\n` +
            (doctorOnlyMode
              ? REBOOK_HINT
              : `Puedes reagendar cuando gustes desde tu portal.\n\n`) +
            `_Atte: ${CLINIC_NAME}_`
          : `¡Hola ${firstName}! ❌\n\n` +
            `Lamentamos informarte que tu cita del *${formattedDate}* a las *${formattedTime}* ha sido CANCELADA por la clínica.\n\n` +
            (doctorOnlyMode
              ? REBOOK_HINT
              : `Por favor entra a tu portal para elegir un nuevo día.\n\n`) +
            `_Atte: ${CLINIC_NAME}_`;
    } else if (isReschedule) {
      messageBody =
        updatedBy === "patient"
          ? `¡Hola ${firstName}! 📅\n\n` +
            `Confirmamos que has REPROGRAMADO tu cita.\n\nNueva fecha: *${formattedDate}* a las *${formattedTime}*.\n\n` +
            `¡Te esperamos! ✨\n\n_Atte: ${CLINIC_NAME}_`
          : `¡Hola ${firstName}! 📅\n\n` +
            `Tu cita ha sido REPROGRAMADA por la clínica.\n\nNueva fecha: *${formattedDate}* a las *${formattedTime}*.\n\n` +
            (doctorOnlyMode
              ? CHANGE_HINT
              : `*Si este nuevo horario no te funciona*, entra a tu portal para elegir otro día o cancelarla.\n\n`) +
            `_Atte: ${CLINIC_NAME}_`;
    } else if (payload.type === "UPDATE" && record.status === "confirmed") {
      messageBody =
        `¡Hola ${firstName}! ✅\n\n` +
        `Tu cita del *${formattedDate}* a las *${formattedTime}* ha sido CONFIRMADA.\n\n` +
        `¡Te esperamos! ✨\n\n_Atte: ${CLINIC_NAME}_`;
    } else {
      console.log(`Appointment ${appointmentId}: event ignored.`);
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
        Authorization: "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
      },
      body: twilioBody.toString(),
    });

    // The response body carries the recipient number and the full message text,
    // so it is never logged. Only the status code and the appointment id are.
    if (!twilioResponse.ok) {
      console.error(
        `Appointment ${appointmentId}: Twilio rejected the message with status ${twilioResponse.status}.`,
      );
    } else {
      console.log(
        `Appointment ${appointmentId}: message accepted by Twilio (status ${twilioResponse.status}).`,
      );
    }

    return new Response(JSON.stringify({ delivered: twilioResponse.ok }), {
      status: twilioResponse.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    // The error may embed the request payload, so only its type is logged.
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(
      `Appointment ${appointmentId}: unhandled failure (${errorName}).`,
    );
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
