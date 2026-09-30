// Adapted from Origin UI's autogrowing textarea, retrieved through 21st.dev.
// https://21st.dev/@originui/components/textarea
import { forwardRef, type ComponentProps } from "react";
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea">
>(({ className = "", onInput, ...props }, ref) => (
  <textarea
    autoComplete="off"
    {...props}
    ref={ref}
    className={`textarea ${className}`}
    onInput={(event) => {
      const element = event.currentTarget;
      element.style.height = "auto";
      element.style.height = Math.min(element.scrollHeight, 220) + "px";
      onInput?.(event);
    }}
  />
));
Textarea.displayName = "Textarea";
