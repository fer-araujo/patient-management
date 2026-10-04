import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { makeSession, supabaseMock } from "../../test/supabaseMock";
import type { AppRole } from "../../features/auth/useAuthRole";
import { Header } from "./Header";

const CLINICAL_ENTRY = "Centro Clínico";
const BUSINESS_ENTRY = "Administración";

const renderHeader = async (role: AppRole | null, path: string) => {
  if (role) {
    supabaseMock.setSession(makeSession(`${role}-user`));
    supabaseMock.onFrom("profiles", { data: { role } });
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>,
  );
  // The logout button is always there; wait for the role to resolve.
  await screen.findByTitle("Cerrar sesión");
  if (role) {
    await waitFor(() => expect(supabaseMock.queries("profiles")).toHaveLength(1));
  }
};

/** Settles the role lookup before asserting on what is NOT rendered. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Header staff entries", () => {
  it("the doctor sees Administración from Centro Clínico", async () => {
    await renderHeader("doctor", "/doctor/dashboard");

    expect(await screen.findByText(BUSINESS_ENTRY)).toBeInTheDocument();
    expect(screen.queryByText(CLINICAL_ENTRY)).not.toBeInTheDocument();
  });

  it("the doctor sees Centro Clínico from Administración", async () => {
    await renderHeader("doctor", "/doctor/admin");

    expect(await screen.findByText(CLINICAL_ENTRY)).toBeInTheDocument();
    expect(screen.queryByText(BUSINESS_ENTRY)).not.toBeInTheDocument();
  });

  it("an admin in Administración gets only the Administración entry", async () => {
    await renderHeader("admin", "/doctor/admin");

    expect(await screen.findByText(BUSINESS_ENTRY)).toBeInTheDocument();
    expect(screen.queryByText(CLINICAL_ENTRY)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Volver a Consultas")).not.toBeInTheDocument();
  });

  it("an admin anywhere else still never sees Centro Clínico", async () => {
    await renderHeader("admin", "/doctor/dashboard");

    expect(await screen.findByText(BUSINESS_ENTRY)).toBeInTheDocument();
    expect(screen.queryByText(CLINICAL_ENTRY)).not.toBeInTheDocument();
  });

  it.each<[AppRole | null, string]>([
    ["patient", "/dashboard"],
    ["patient", "/doctor/admin"],
    [null, "/doctor/dashboard"],
  ])("%s at %s sees no staff entry", async (role, path) => {
    await renderHeader(role, path);
    await settle();

    expect(screen.queryByText(BUSINESS_ENTRY)).not.toBeInTheDocument();
    expect(screen.queryByText(CLINICAL_ENTRY)).not.toBeInTheDocument();
  });
});
