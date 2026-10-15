import { useLayoutEffect, useRef } from "react";

const supportsFieldSizing =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

/**
 * A textarea that grows with its text, so the page is the only scroll area
 * (no inner scrollbar). Uses `field-sizing: content` where the browser has it
 * and measures the text otherwise. Its minimum height comes from the caller's
 * `min-h-*` class; a `grow` class may stretch it further to fill its box.
 */
export const AutoGrowTextarea = ({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing) return;
    const fit = () => {
      // Measure the text without any flex stretch, then let it stretch again.
      el.style.flexGrow = "0";
      el.style.height = "auto";
      const borders = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + borders}px`;
      el.style.flexGrow = "";
    };
    fit();
    // Width changes (window resize, browser zoom) rewrap the text.
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  return (
    <textarea
      ref={ref}
      {...props}
      className={`field-sizing-content overflow-hidden ${className}`}
    />
  );
};
