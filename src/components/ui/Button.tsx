import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline";
}

export const Button = ({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) => {
  const baseStyle =
    "w-full py-3 px-6 font-semibold rounded-xl transition-all focus:ring-4 focus:outline-none flex justify-center items-center gap-2 cursor-pointer";

  const variants = {
    // Usando brand-primary (#07A996) y brand-primary-hover (#068F7F)
    primary:
      "bg-brand-primary text-white hover:bg-brand-primary-hover focus:ring-brand-primary/30 shadow-md",
    secondary:
      "bg-brand-light text-brand-dark border-2 border-brand-light focus:ring-brand-light",
    outline:
      "text-brand-dark hover:bg-slate-100 border-2 border-slate-200 transition-all flex items-center justify-center gap-2",
  };

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
