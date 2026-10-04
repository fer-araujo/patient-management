import { PRIVACY_NOTICE_VERSION } from "../../lib/legal/privacyNotice";

/**
 * Integral privacy notice (aviso de privacidad integral).
 *
 * Structure follows LFPDPPP 2025 (DOF 20-03-2025) art. 15, fractions I-VI.
 * Legal basis and sources are documented in docs/compliance.md.
 *
 * PLACEHOLDERS: the bracketed values below must be replaced with the clinic's
 * real data before production. They are deliberately left visible rather than
 * invented. When this text changes, bump PRIVACY_NOTICE_VERSION and
 * public.privacy_notice_version() together.
 */

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h4 className="font-bold text-brand-dark mt-4">{children}</h4>
);

// Same markup conventions as TermsAndConditionsContent: the modal body sets
// the text size and spacing.
export const PrivacyPolicyContent = () => (
  <>
    <p className="font-bold text-brand-dark">
      Aviso de Privacidad · Versión {PRIVACY_NOTICE_VERSION}
    </p>

    <p>
      Este aviso se emite conforme a la{" "}
      <strong>
        Ley Federal de Protección de Datos Personales en Posesión de los
        Particulares
      </strong>{" "}
      publicada en el Diario Oficial de la Federación el 20 de marzo de 2025.
    </p>

    <Heading>1. Quién es responsable de sus datos</Heading>
    <p>
      La <strong>Dra. Carmen Torres</strong>, médica con consultorio privado en
      Monterrey, Nuevo León (en adelante, "la Responsable").
    </p>
    <p>
      El domicilio del consultorio para oír y recibir notificaciones se le
      proporciona al confirmar su cita, y está disponible en el aviso de
      privacidad integral, que puede solicitar en el consultorio o por los
      medios de contacto de abajo.
    </p>
    <p>
      Contacto para temas de privacidad: correo{" "}
      <strong>torrescarmen61@gmail.com</strong> y teléfono{" "}
      <strong>+52 81 1178 4747</strong>.
    </p>

    <Heading>2. Qué datos recabamos</Heading>
    <ul className="list-disc pl-5 space-y-1">
      <li>
        <strong>Identificación y contacto:</strong> nombre completo, número de
        teléfono celular, correo electrónico (opcional), año o fecha de
        nacimiento y, si usted lo indica, quién le recomendó.
      </li>
      <li>
        <strong>Datos técnicos:</strong> la fecha y hora en que acepta este
        aviso y el tipo de navegador que usó, como constancia de su
        consentimiento.
      </li>
    </ul>
    <p>
      <strong>Datos personales sensibles.</strong> Para atenderle tratamos
      datos sobre su <strong>estado de salud</strong>: motivo de consulta,
      historia clínica, notas médicas, diagnósticos, alergias, enfermedades
      crónicas, tipo de sangre, medicamentos indicados, y los estudios y
      fotografías clínicas que usted o la doctora agreguen a su expediente.
    </p>
    <p>
      Esta plataforma <strong>no</strong> recaba datos bancarios ni de tarjetas.
    </p>

    <Heading>3. Para qué usamos sus datos</Heading>
    <ul className="list-disc pl-5 space-y-1">
      <li>Brindarle atención médica y dar seguimiento a su tratamiento.</li>
      <li>
        Integrar y conservar su expediente clínico, como lo exige la
        NOM-004-SSA3-2012.
      </li>
      <li>
        Agendar, confirmar, cambiar o cancelar sus citas y avisarle por
        WhatsApp.
      </li>
      <li>Cumplir obligaciones legales y requerimientos de autoridades sanitarias.</li>
    </ul>
    <p>
      No usamos sus datos para publicidad ni para fines distintos a los
      anteriores. Si algún día quisiéramos hacerlo, le pediríamos antes su
      consentimiento.
    </p>

    <Heading>4. Su consentimiento</Heading>
    <p>
      Por tratarse de datos de salud, la ley exige su consentimiento{" "}
      <strong>expreso y por escrito</strong>. Al marcar la casilla de
      aceptación, usted da ese consentimiento y guardamos constancia de la
      versión de este aviso que aceptó, la fecha y la hora. Puede{" "}
      <strong>revocarlo</strong> en cualquier momento con el formulario descrito
      en el punto 7; la revocación no tiene efectos hacia el pasado.
    </p>

    <Heading>5. Quién más trata sus datos por nuestra cuenta</Heading>
    <p>
      Usamos proveedores tecnológicos que tratan sus datos únicamente para
      prestarnos el servicio (encargados), y que pueden ubicarse fuera de
      México:
    </p>
    <ul className="list-disc pl-5 space-y-1">
      <li>
        <strong>Supabase, Inc.</strong> — aloja la base de datos, el inicio de
        sesión y los archivos del expediente. Servidores en:{" "}
        <strong>Estados Unidos (Virginia del Norte)</strong>.
      </li>
      <li>
        <strong>Twilio Inc.</strong> (Estados Unidos) y{" "}
        <strong>WhatsApp / Meta Platforms</strong> — envían los avisos de sus
        citas. Solo reciben su número de teléfono, su nombre de pila, y la
        fecha, hora y estado de la cita. <strong>No</strong> reciben su
        diagnóstico ni el tratamiento.
      </li>
    </ul>
    <p>
      No vendemos sus datos. Solo los comunicamos a terceros cuando una ley o
      una autoridad competente lo exija, o cuando sea necesario para su
      diagnóstico o tratamiento médico (por ejemplo, un laboratorio), casos en
      los que la ley no requiere su consentimiento.
    </p>

    <Heading>6. Cómo protegemos sus datos</Heading>
    <p>
      Su expediente solo es visible para usted y para el personal autorizado
      de la clínica. Cada acceso y cambio queda registrado en una bitácora, y
      las notas médicas cerradas no se pueden alterar: las correcciones se
      agregan como notas aclaratorias con fecha.
    </p>

    <Heading>7. Sus derechos (ARCO) y cómo ejercerlos</Heading>
    <p>
      Usted puede <strong>Acceder</strong> a sus datos,{" "}
      <strong>Rectificarlos</strong> si están mal, pedir su{" "}
      <strong>Cancelación</strong> u <strong>Oponerse</strong> a un uso, además
      de revocar su consentimiento. Es gratuito.
    </p>
    <ul className="list-disc pl-5 space-y-1">
      <li>
        <strong>En línea:</strong> entre a su Portal de Paciente, sección{" "}
        <em>"Mis datos personales"</em>. Ahí puede descargar una copia de sus
        datos y enviar su solicitud.
      </li>
      <li>
        <strong>Por otro medio:</strong> escriba a{" "}
        <strong>torrescarmen61@gmail.com</strong> o acuda al consultorio.
        Deberá acreditar su identidad.
      </li>
    </ul>
    <p>
      Le responderemos en un máximo de <strong>20 días hábiles</strong> y, si
      procede, aplicaremos el cambio dentro de los <strong>15 días hábiles</strong>{" "}
      siguientes.
    </p>
    <p>
      <strong>Importante sobre la cancelación:</strong> la NOM-004-SSA3-2012
      obliga a conservar el expediente clínico al menos{" "}
      <strong>5 años</strong> desde su última atención médica. Durante ese
      plazo no podemos borrarlo; al terminar, podemos anonimizarlo.
    </p>
    <p>
      Si considera que no atendimos su solicitud, puede acudir a la{" "}
      <strong>Secretaría Anticorrupción y Buen Gobierno</strong>, autoridad
      encargada de vigilar esta ley.
    </p>

    <Heading>8. Cambios a este aviso</Heading>
    <p>
      Si este aviso cambia, publicaremos la nueva versión en este sitio y se la
      mostraremos antes de su siguiente solicitud de cita, para que la lea y la
      acepte de nuevo. La versión vigente es la{" "}
      <strong>{PRIVACY_NOTICE_VERSION}</strong>.
    </p>
  </>
);
