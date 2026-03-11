import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input = ({
  label,
  error,
  className = "",
  id,
  ...props
}: InputProps) => {
  const inputId = id || label.replace(/\s+/g, "-").toLowerCase();

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-brand-dark font-medium text-lg">
        {label}
      </label>
      <input
        id={inputId}
        className={`px-4 py-4 border-2 rounded-xl text-xl text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all ${
          error ? "border-red-500" : "border-brand-light"
        }`}
        {...props}
      />
      {error && (
        <span className="text-red-600 text-md font-medium">{error}</span>
      )}
    </div>
  );
};
