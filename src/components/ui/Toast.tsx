import { Toaster } from "react-hot-toast";

export const Toast = () => (
  <Toaster
    position="top-right"
    toastOptions={{
      className: "text-sm font-bold shadow-lg",
      style: {
        borderRadius: "16px",
        background: "#ffffff",
        color: "#1e293b", // slate-800
        border: "1px solid #e2e8f0", // slate-200
      },
      success: {
        style: { borderLeft: "4px solid #0d9488" }, // El verde/teal de tu brand-primary
        iconTheme: { primary: "#0d9488", secondary: "#fff" },
      },
      error: {
        style: { borderLeft: "4px solid #f43f5e" }, // Rose-500 para errores
        iconTheme: { primary: "#f43f5e", secondary: "#fff" },
      },
    }}
  />
);
