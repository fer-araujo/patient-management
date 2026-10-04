# Mexican Legal Compliance — Gap Analysis (Phase 2)

> ## ⚠️ This is a technical gap analysis, NOT a legal certification
>
> It was prepared by the development team to map legal requirements to what the
> software does. It is not legal advice and does not certify compliance with any
> law or standard. **Before production it must be reviewed by a Mexican lawyer
> specializing in health law or personal data protection**, who should also
> review the privacy notice text in
> `src/components/legal/PrivacyPolicyContent.tsx`.

- **Scope:** web app for the private, single-doctor practice of Dra. Carmen
  Torres (Monterrey, Nuevo León). React 19 + Vite frontend, Supabase backend
  (Postgres, Auth, Storage, Edge Functions), WhatsApp notices via Twilio.
- **Research date:** 2026-09-23. Every requirement cites the source that was
  actually read. Anything that could not be checked against a primary source
  is marked **NOT VERIFIED** and must not be relied on.
- **Status legend:** **Met** — implemented and enforced server-side.
  **Partial** — implemented in part or enforced only by process. **Missing** —
  not implemented.

## Sources consulted

| ID | Document | URL | Version read |
| --- | --- | --- | --- |
| S1 | Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf | "Nueva Ley publicada en el DOF el 20 de marzo de 2025", texto vigente, última reforma DOF 14-11-2025 |
| S2 | NOM-004-SSA3-2012, Del expediente clínico | https://dof.gob.mx/nota_detalle.php?codigo=5272787&fecha=15/10/2012 | DOF 15-10-2012 |
| S3 | Status of NOM-004 in the national standards catalog | https://platiica.economia.gob.mx/normalizacion/nom-004-ssa3-2012/ | "Vigente"; last systematic review 15-01-2018, result "Confirmación" |
| S4 | NOM-024-SSA3-2012, Sistemas de información de registro electrónico para la salud | http://www.dgis.salud.gob.mx/descargas/normatividad/normas/DOF-30NOV12-NOM-024-SSA3-2012.pdf | DOF 30-11-2012 |
| S5 | Status of NOM-024 in the national standards catalog | https://platiica.economia.gob.mx/normalizacion/nom-024-ssa3-2012/ | "Vigente"; last systematic review 06-02-2018, result "Confirmación" |
| S6 | Reglamento de Insumos para la Salud | http://www.oag.salud.gob.mx/descargas/LV/56-31052021.pdf | texto vigente, última reforma DOF 31-05-2021 |
| S7 | Supabase — Available regions | https://supabase.com/docs/guides/platform/regions | read 2026-09-23 |
| S8 | Twilio Data Protection Addendum | https://www.twilio.com/en-us/legal/data-protection-addendum | **only a search-engine summary was seen; page not read directly** |

## 1. LFPDPPP 2025 (personal data)

**Supervising authority.** INAI no longer exists. The 2025 law defines
"Secretaría" as the **Secretaría Anticorrupción y Buen Gobierno** (S1, art. 2
fr. XV), which oversees compliance (art. 38), handles rights-protection
procedures (arts. 40-52) and sanctions (arts. 56-61). The transitory articles
of the decree abrogate the 2010 law (S1, Transitorio Segundo fr. I) and
transfer INAI's data-protection files to that Secretaría (Transitorio Décimo).

**Regulations (Reglamento).** The law refers to a Reglamento for identity
verification, procedures and compensatory measures (S1, arts. 17, 40, 41, 54,
57). **NOT VERIFIED:** whether a new Reglamento has been published, and whether
the 2011 Reglamento (issued under the abrogated law) is still applied. A web
search on 2026-09-23 found no new Reglamento in the DOF. Re-check before go-live.

| Requirement | Source | Status | Where implemented / why not |
| --- | --- | --- | --- |
| Health data is **sensitive** ("estado de salud presente o futuro") | S1 art. 2 fr. VI | Met | Privacy notice §2 identifies sensitive data explicitly. |
| Sensitive data requires **express and written consent** via "firma autógrafa, firma electrónica, o cualquier mecanismo de autenticación" | S1 art. 8 | **Met** (pending legal review) | Required checkbox with explicit wording (`PrivacyConsent.tsx`, shared by registration and the returning-patient consent step). Since Phase 3 the phone is verified by OTP **before** registration: `register_me` / `accept_privacy_notice` read the phone from the authenticated session, refuse an outdated notice version, and store a `consents` row (version, timestamp, user agent) atomically with the patient (`20260922181200_verified_booking.sql`). The OTP is the "mecanismo de autenticación" (gap G1 fixed). |
| Consent may be **revoked**; the notice must describe how | S1 art. 7 (last paragraph) | Met | `arco_requests.request_type = 'revocation'` via the portal form; notice §4 and §7. |
| Privacy notice contents: identity and address of controller; data processed identifying sensitive data; purposes; options to limit use; ARCO mechanism; how changes are communicated | S1 art. 15 fr. I-VI | **Partial** | `PrivacyPolicyContent.tsx` covers all six items; contact email, phone and Supabase region are filled. The controller's address is intentionally omitted from the online notice (owner decision, accepted risk — see G3). |
| Electronic collection: simplified notice at collection time with a pointer to the integral notice | S1 art. 16 fr. II | Partial | The full notice is shown in a modal from the consent checkbox. No separate simplified notice text exists; showing the integral one is a superset, but a lawyer should confirm. |
| Purposes limited to the notice; new purpose requires new consent | S1 arts. 11, 12 | Met (by process) | Notice declares no secondary purposes; the old notice's marketing/survey purpose was removed because the app does not do it. |
| Security measures: administrative, technical and physical | S1 art. 18 | Partial | Technical: Phase 1 RLS + Phase 2 audit trail, append-only tables, record freezing, upload limits. Administrative/physical measures (policies, device security, staff training) are outside the software — G12. |
| **Breach notification**: breaches that significantly affect patrimonial or moral rights must be reported to the titulares "de forma inmediata" | S1 art. 19 | **Missing** | No incident-response procedure exists (G9). The law text read does not contain an obligation to notify the Secretaría; **NOT VERIFIED** whether the Reglamento adds one. |
| Confidentiality duty for everyone who processes the data | S1 art. 20 | Partial | Access is limited by RLS; no written confidentiality agreements exist (process item). |
| ARCO rights: access, rectification, cancellation, opposition | S1 arts. 21-26 | Met | Access: `export_my_data()` rendered as a readable, printable document ("Mis datos personales" → "Ver y descargar mis datos"; save as PDF from the print dialog); clinical summary on request (migration 14). R/C/O: `submit_arco_request()` form in the portal; staff resolve in Admin → "Solicitudes ARCO" (`20260922181000_arco_rights.sql`). |
| ARCO request must include name, contact, identity documents, description | S1 art. 28 | Partial | In-app requests are tied to the patient's verified phone session (identity). Requests by other channels need manual identity checks (process). |
| Designate a person or department to handle ARCO requests | S1 art. 29 | Missing (process) | The doctor must formally designate herself or a staff member (checklist item). |
| **Response deadline: 20 días** to communicate the decision, **15 días** more to make it effective; each extendable once by an equal period | S1 art. 31; "días" = business days per art. 2 fr. VIII | Met | Shown in the portal form and in the privacy notice; the admin list computes an approximate due date (`addBusinessDays`, weekends only — public holidays not subtracted). |
| Access satisfied by electronic documents | S1 art. 32 | Met | Printable document, savable as PDF. |
| ARCO is free (except reproduction costs) | S1 art. 34 | Met | Stated in notice §7. |
| Cancellation → blocking period then deletion; not required when data is processed for medical diagnosis/health services by a professional under secrecy | S1 arts. 24, 25 fr. VII | Met | No hard delete. `anonymize_patient()` refuses inside the NOM-004 retention window and anonymizes after it. |
| Delete data once no longer needed, after blocking and retention | S1 art. 10 | Partial | Anonymization exists but is manual; no scheduled review of records past retention (G14). |
| Transfers to third parties (national or foreign) distinct from the *encargado*: communicate notice; the notice must say whether the titular accepts | S1 art. 35 | Met | Notice §5 states the only communications are those exempt from consent. |
| Transfers without consent allowed for medical diagnosis/treatment and when required by law | S1 art. 36 fr. I, II | Met | Notice §5. |
| *Encargados* (processors): Supabase, Twilio, Meta/WhatsApp | S1 art. 2 fr. XII, XX (a communication to the encargado is not a "transferencia") | **Partial** | Disclosed in notice §5 with international location. **NOT VERIFIED:** the 2025 law text read contains no article detailing processor contract terms; the 2011 Reglamento did. Accepting and filing each provider's DPA is a checklist item. |

## 2. NOM-004-SSA3-2012 (clinical record)

Applies to "establecimientos para la atención médica" of the public, social and
private sectors, including private practices (S2, field of application).
Status "Vigente", confirmed in the 2018 systematic review (S3). **NOT
VERIFIED:** whether any draft modification (PROY-NOM) is in progress in 2026.

| Requirement | Source | Status | Where implemented / why not |
| --- | --- | --- | --- |
| Keep the record **at least 5 years from the last medical act** | S2 num. 5.4 | Met | `clinical_record_retention()` = 5 years; `anonymize_patient()` refuses inside the window. Last act = latest of completed past appointment, note, addendum, prescription, uploaded file (`last_clinical_act_at`). |
| Confidentiality; access by written request of patient/representative or authorized physician | S2 num. 5.5, 5.6 | Met (technical) | Phase 1 RLS: patient sees own record only, staff see all. |
| Every note has date, time, full name and signature (autograph, electronic or digital) of the author | S2 num. 5.10 | **Partial** | `created_at` and `author_id`. Since migration 20 the note view shows date **and time** and "Escrita por" with the author's full name (`profiles.first_name/last_name`); addenda show their author too. **No electronic signature and no cédula** on the note (G5). |
| Notes written without "enmendaduras ni tachaduras" | S2 num. 5.11 | Met | Electronic equivalent: once "Finalizar Consulta" runs `finalize_consultation()`, triggers reject any change to the note's clinical fields (including `prognosis` and `vital_signs` since migration 20) and any delete, for every role. Corrections go to append-only `clinical_note_addenda`, shown under the note in chronological order (`NoteAddenda.tsx`). Prescriptions freeze with the consultation. Since migration 20 the note starts empty (no pre-written text is frozen), vital signs are stored as data instead of abbreviations ("TA") inside the text, and a note cannot be finalized without a diagnosis and a plan (UI and `finalize_consultation()`). |
| Electronic records are optional ("podrán utilizar medios electrónicos…") subject to applicable law | S2 num. 5.12 | Met | Triggers NOM-024 for the electronic system — see §3. |
| Patient identification on each note (name, age, sex) | S2 num. 5.9 | Met | Since migration 20 the consultation sidebar and the note view show name, age (from `dob`) and sex (`gender`). A missing value is shown as "sin registrar". |
| Patient address in the identification data | S2 num. 5.2.3 | Met | `patients.address` (migration 20), edited in "Editar datos del paciente", included in the patient's export and cleared by `anonymize_patient()`. |
| Historia clínica minimum contents (interrogatorio, exploración física, resultados, diagnósticos, pronóstico, indicación terapéutica) | S2 num. 6.1 | **Partial** | Since migration 20: antecedentes heredofamiliares, personales patológicos, personales no patológicos and padecimiento actual on the patient record (doctor-only write, shown in the consultation sidebar with allergies, chronic conditions and blood type); diagnosis, prognosis and plan on every note. Still no interrogatorio por aparatos y sistemas or structured exploración física (G10). |
| Nota de evolución: vital signs (6.2.2), diagnosis (6.2.4), prognosis (6.2.5), treatment and medical indications, "en el caso de medicamentos, señalando como mínimo la dosis, vía de administración y periodicidad" (6.2.6) | S2 num. 6.2 (6.2.1-6.2.6) | Partial | Since migration 20: `vital_signs` (blood pressure, oxygenation, weight, height) and `prognosis` on the note, diagnosis and plan required to finalize. Medication items keep name, dose and free-text indications (owner decision); the indications field suggests "Ej. 1 tableta vía oral cada 8 h por 5 días" but **route and duration are not enforced fields** (G11). |

## 3. NOM-024-SSA3-2012 (electronic health record systems, "SIRES")

**Mandatory or voluntary?** Numeral 1.2 makes it "de observancia obligatoria …
para todos los establecimientos que presten servicios de atención médica que
formen parte del Sistema Nacional de Salud **que adopten** un Sistema de
Información de Registro Electrónico para la Salud", and for whoever owns or
distributes such systems (S4). Numeral 3.51 includes private providers in the
Sistema Nacional de Salud, and numeral 1.3 applies to the public, private and
social sectors. **Reading of the text:** adopting an electronic record is
voluntary (NOM-004 num. 5.12), but once this app is used as the clinical record,
NOM-024 applies to it. **NOT VERIFIED:** whether DGIS certification (chapter 7)
is actually required or enforced for a solo private practice — a lawyer or DGIS
should confirm.

**Updated or cancelled?** Status "Vigente", confirmed in the 2018 systematic
review (S5). No later modification or cancellation was found; **NOT VERIFIED**
beyond that catalog entry.

| Requirement | Source | Status | Where implemented / why not |
| --- | --- | --- | --- |
| Confidentiality of identity, integrity and reliability of clinical information | S4 num. 5.3 | Partial | RLS (Phase 1), frozen notes, append-only addenda and audit log (Phase 2). |
| Keep the system operating to preserve integrity and availability over time | S4 num. 5.6 | Partial | Depends on Supabase backups and plan; no documented backup/restore test (G13). |
| Information security management system ensuring confidentiality, integrity, availability, **traceability** and non-repudiation | S4 num. 6.6.1 | Partial | Traceability: `audit_log` for every write on patients, appointments, clinical_notes, prescriptions, patient_files, addenda, consents, arco_requests, plus FINALIZE/EXPORT/ANONYMIZE events. Stores column names only. **Reads are not logged** (G6). No formal ISMS (process). |
| Records kept as **structured, unalterable electronic documents**; allow **firma electrónica avanzada** of the professional | S4 num. 6.6.2 | **Partial** | Unalterable after finalization (triggers). **No FEA** (G5). |
| All users authenticated at least by username + password; additional factors recommended | S4 num. 6.6.3 | Partial | Staff: email + password; patients: phone OTP. MFA for staff not enforced (G8). |
| Role-based authorization | S4 num. 6.6.4 | Met | `is_staff()` / `current_patient_id()` (Phase 1). |
| Export patient information; controls over the titular's consents | S4 num. 6.6.6 | Partial | `export_my_data()` (JSON; not in the DGIS "Guías y Formatos" — **NOT VERIFIED** which format DGIS expects). Consents stored in `consents`. |
| Audit record definition: chronological log of user activity | S4 num. 3.42 | Partial | The definition speaks of reconstructing prior states; the log deliberately stores **column names, not values**, to avoid duplicating health data. Frozen notes + addenda preserve clinical history; demographic edits are not reconstructable. Trade-off to be confirmed by counsel. |
| Author identification / non-repudiation | S4 num. 3.45, 6.6.1 | Partial | `author_id`, `finalized_by`, `audit_log.actor_id`. Shared accounts would defeat this — each person must have their own login (checklist). |

## 4. Prescriptions

The platform **does not issue official prescriptions**. It stores what was
prescribed as part of the clinical record.

| Requirement | Source | Status | Where implemented / why not |
| --- | --- | --- | --- |
| A receta médica must have **printed** full name, address and cédula profesional of the prescriber, date and **firma autógrafa** | S6 art. 29 | Not applicable by design | The app shows none of these, so it cannot pass as a receta. The official prescription is issued separately on paper by the doctor. |
| Prescriber indicates dose, presentation, route, frequency and duration | S6 art. 30 | Partial | Applies to the paper receta; the record captures name, dose and free-text indications only (G11). |
| Only licensed professionals may issue recetas | S6 art. 28 | N/A | The app issues none. |
| Disclaimer | — | Met | `PrescriptionDisclaimer.tsx` shows "Registro informativo del expediente. No es una receta médica oficial." in the consultation workspace ("Recetas e Indicaciones" tab) in the patient's "Mis Medicamentos" view (always shown), and in the printable "Mis datos" document. |

**Assessment.** Because art. 29 requires a printed name, address, cédula and a
handwritten signature, a screen or JSON entry lacking all of them does not meet
the definition of a receta médica, and the disclaimer removes any ambiguity for
the patient. **NOT VERIFIED:** any COFEPRIS guidance on electronic
prescriptions (none was read), and controlled-substance rules (the app must
never be used for those — out of scope).

## 5. Processors and cross-border transfer

| Provider | Role | Data received | Location | Verified? |
| --- | --- | --- | --- | --- |
| Supabase, Inc. | Hosting, Postgres, Auth, Storage, Edge Functions | Everything in the record | Region chosen at project creation; "the region you choose also determines where your primary project data is stored". **No Mexico region exists** — nearest are US and São Paulo (S7). | Region list verified (S7). **NOT VERIFIED:** this project's actual region, and the exact dashboard page that shows it (the docs page consulted does not say; the fetch of Supabase's "change project region" troubleshooting page was declined during research). Check it in the project dashboard settings or with Supabase support and put it in the notice. |
| Twilio Inc. | WhatsApp message delivery (edge function `notify-appointment`) | Phone, first name, appointment date/time and status; no service name since Phase 1 | Per a search-engine summary of S8, Twilio's primary processing facilities are in the United States | **Partially** — S8 not read directly. |
| Meta Platforms / WhatsApp | Final message delivery | Same as Twilio | **NOT VERIFIED** | No. |
| SMS provider for Supabase phone OTP | Sends login codes | Phone number | Configured in the Supabase dashboard; the repo's `supabase/config.toml` has Twilio SMS disabled locally | **NOT VERIFIED** which provider production uses. |

**What the notice must say (and now does, in §5):** the identity of each
processor, what data it receives, that it may be outside Mexico, and that it
processes only on the clinic's behalf. Under S1 art. 2 fr. XX a communication
to an *encargado* is not a *transferencia*, so no transfer-consent clause is
needed for them; a lawyer should confirm this reading for cross-border hosting.

## 6. What Phase 2 implemented

Migrations, in the order they must be applied (see `docs/security-runbook.md`,
Phase 2):

1. `20260922180700_audit_log.sql` — append-only `audit_log`, generic row
   trigger on the five clinical tables, `write_audit_event()`.
2. `20260922180800_consents.sql` — `consents` table, `privacy_notice_version()`,
   `request_appointment` re-created with consent parameters (old overload
   dropped).
3. `20260922180900_clinical_integrity.sql` — `finalized_at/by`, `author_id`,
   freeze triggers, `clinical_note_addenda`, `finalize_consultation()`.
4. `20260922181000_arco_rights.sql` — `arco_requests`, `submit_arco_request()`,
   `resolve_arco_request()`, `export_my_data()`, `anonymize_patient()`.
5. `20260922181100_storage_limits.sql` — 10 MB / PDF-JPEG-PNG-HEIC on
   `clinical_records`, `register_my_upload()`.

Phase 3 (runbook, "Phase 3 — Verified booking"):

6. `20260922181200_verified_booking.sql` — phone OTP before booking;
   `get_my_booking_profile()`, `accept_privacy_notice()`, `register_me()`;
   `request_my_appointment()` with `p_reason`; `appointments.reason`;
   anonymous `request_appointment` dropped. Closes G1.

## 7. Residual gaps NOT implemented (prioritized)

| # | Priority | Gap | Why it matters | Suggested fix |
| --- | --- | --- | --- | --- |
| G1 | Fixed | Consent from the anonymous flow was not tied to an authenticated identity | Art. 8 asks for a signature or "mecanismo de autenticación"; anyone could type anyone's phone | Fixed in Phase 3 (`20260922181200_verified_booking.sql`): booking requires a phone OTP first, and consent is recorded by `register_me` / `accept_privacy_notice` against the phone in the authenticated session. Until a paid Twilio account exists, only Supabase test numbers can complete the OTP |
| G2 | High (partly mitigated) | Patients registered before Phase 2 have no `consents` row | No evidence of consent for the existing base | Since Phase 3, a returning patient who books online must accept the current notice first (`accept_privacy_notice`). Patients who never book online still need a signed consent at their next visit |
| G3 | High (accepted risk) | The online notice omits the controller's address: the practice operates from the doctor's home and she will not publish it. The notice states the address is given when an appointment is confirmed and in the integral notice available on request. Supabase region disclosed: East US (North Virginia), i.e. a cross-border transfer to the United States | Art. 15 fr. I requires identity and address in the notice; omitting it online is a knowingly accepted gap, not compliance. Mitigations: a commercial/virtual office address for notifications would close it | Owner decision, 2026-09-24, with no legal counsel. Keep a printed integral notice (with an address) at the practice |
| G4 | Fixed | The back arrow in the consultation screen used to call the same handler as "Finalizar Consulta", which would have permanently frozen an unfinished note | — | Fixed: the back arrow saves a draft only (`saveConsultation(false)`); only "Finalizar Consulta" finalizes |
| G5 | Medium (partly fixed) | No electronic signature and no cédula on the note. The author's full name and the time are rendered since migration 20 | NOM-004 5.10, NOM-024 6.6.2 | e.firma (SAT) or an FEA provider for finalized notes; render the cédula on the note |
| G6 | Medium | Reads are not audited (who viewed which record) | NOM-024 6.6.1 traceability | Log views through an RPC or edge function; Postgres triggers cannot see SELECTs |
| G7 | Medium | Database owner can disable triggers and alter the log; no off-site copy | Append-only is only as strong as the owner account | Periodic export of `audit_log` to write-once storage; restrict who holds owner credentials |
| G8 | Medium | MFA not enforced for staff | NOM-024 6.6.3 recommends additional factors | Enable Supabase Auth MFA (TOTP) for doctor/admin |
| G9 | Medium | No breach-response procedure | LFPDPPP art. 19 requires immediate notice to titulares | Write an incident runbook: detection, assessment, WhatsApp/email notice template |
| G10 | Medium (partly fixed) | Antecedentes and padecimiento actual exist since migration 20; no interrogatorio por aparatos y sistemas or structured exploración física | NOM-004 6.1 | Add those sections to a first-visit historia clínica form |
| G11 | Medium (accepted for now) | Medication items lack route of administration and duration fields; the indications placeholder asks for them, nothing enforces them (owner decision: keep free text) | NOM-004 6.2; RIS art. 30 | Add structured fields to `MedicationItem` |
| G12 | Medium | Administrative/physical security measures, confidentiality agreements, designated data-protection person | LFPDPPP arts. 18, 20, 29 | Written policies; signed confidentiality agreements; formal designation |
| G13 | Medium | No documented backup and restore test | NOM-024 5.6 | Confirm the Supabase plan's backups / PITR and run a restore drill |
| G14 | Low | Anonymization is manual; no report of records past retention | LFPDPPP art. 10 | Staff report listing patients whose `last_clinical_act_at` is older than 5 years |
| G15 | Low | Storage objects are outside the integrity guarantees: staff can still delete files; a failed `patient_files` registration leaves an upload unaudited | NOM-004 5.11 spirit; traceability | Remove staff DELETE on `storage.objects` for this bucket; reconcile objects vs `patient_files` periodically |
| G16 | Low | ARCO due date skips weekends but not Mexican public holidays | Displayed deadline is approximate (labelled as such) | Add an official holiday calendar |
| G17 | Fixed | The registration form showed a "Estudios o Fotos" picker whose file was never uploaded | — | Fixed: the file is validated on selection and uploaded right after `register_me` creates the record; a failed upload does not block the booking |
| G18 | Low | HEIC images are accepted but most non-Safari browsers cannot preview them | Doctor may not see the image inline | Convert HEIC to JPEG on upload |
| G19 | Low | Webhook secret stored in plaintext in the trigger definition (Phase 1 decision) | See Phase 1 migration 07 header | Move to Supabase Vault |
| G20 | Low | LFPDPPP Reglamento status unknown | Procedures may change | Re-review this document when a new Reglamento is published |

## 8. Pre-production checklist

- [ ] **Legal review** of this document and of the privacy notice by a Mexican lawyer specializing in health or data protection.
- [ ] Replace every `[...]` placeholder in `PrivacyPolicyContent.tsx` (address, contact email, phone, Supabase region).
- [ ] **Delete the Supabase Auth test phone numbers** (the test phone / fixed-OTP list in the dashboard's Phone auth provider settings; exact menu path not verified). A fixed OTP is a permanent key to that patient account.
- [ ] **Demote the developer account `ferno93@gmail.com` from the `doctor` role** (`update public.profiles set role = 'patient' where id = (select id from auth.users where email = 'ferno93@gmail.com');` from the SQL editor) and confirm with Gate 4 of the runbook that the doctor is still staff.
- [ ] **Rotate the webhook secret** (it was exposed during development): new `openssl rand -hex 32`, set it on the edge function, re-run migration `20260922180600_whatsapp_webhook_secret.sql` with the new value, verify the 401 test (runbook step 8d).
- [ ] **Paid Twilio account with an approved WhatsApp message template.** The edge function sends free-form bodies; business-initiated WhatsApp messages outside the 24-hour window require an approved template.
- [ ] Accept and file the Data Processing Agreements of Supabase and Twilio.
- [ ] Confirm the Supabase project region and the SMS provider used for phone OTP; update the notice.
- [ ] Apply Phase 2 migrations in order and pass every gate (runbook, Phase 2).
- [ ] Deploy the frontend **in the same window** as migration `20260922180800_consents.sql` (the booking RPC signature changes).
- [ ] Decide on the optional back-fill that finalizes historical notes (runbook step P2-3b).
- [ ] Obtain signed consent from existing patients who do not book online, at their next visit (G2).
- [ ] Apply `20260922181200_verified_booking.sql` together with the new frontend (it drops the anonymous booking RPC), and configure the paid Twilio account: until then only Supabase test numbers can complete the booking OTP.
- [ ] Formally designate the person who handles ARCO requests (LFPDPPP art. 29).
- [ ] Enable MFA for staff accounts (G8).
- [ ] Confirm backups / point-in-time recovery on the Supabase plan and run one restore test (G13).
- [ ] Each staff member has their own login — no shared accounts (non-repudiation).

## Addendum — clinical notes are staff-only (migration 14)

Raw SOAP notes and their addenda are no longer readable by the patient, neither
through the API nor in the "Mis datos" export. Under NOM-004-SSA3-2012 (5.5)
the patient is entitled to a clinical **summary** prepared by the doctor on
request; the portal form offers it as "Resumen clínico" (ARCO `access`). The
export still covers identification data, appointments, prescriptions, files,
consents and ARCO requests. **Lawyer review:** confirm that the export plus the
summary-on-request satisfies the LFPDPPP access right (art. 22).

## Addendum — NOM-004 consultation record (migration 20)

`20260927110000_nom004_consultation.sql` adds, on every consultation note,
`prognosis` and `vital_signs` (frozen on finalization like the SOAP fields),
requires a diagnosis and a plan to finalize, and adds to the patient record
`address` and the clinical history (`family_history`,
`personal_pathological_history`, `non_pathological_history`,
`current_illness`), writable by the doctor only.

- **Export (owner decision):** "Mis datos" now includes the address and the
  four antecedentes (printable copy: section "Antecedentes"). SOAP notes stay
  excluded (migration 14). **Lawyer review:** confirm the patient may receive
  the antecedentes directly rather than only in the clinical summary.
- **Anonymization** also clears the address; the antecedentes are clinical
  content and are kept, like allergies.
- **Charge and finalization are one transaction:**
  `finalize_consultation_with_payment()` freezes the consultation and records
  the charge in one call, so a failure never leaves a charge for an unfinished
  consultation, or the reverse.
- **Interrupted consultations** reopen with their saved draft; the editor is
  locked until the draft is loaded, so nothing typed can overwrite it.
