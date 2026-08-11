import { type ClipboardEvent, type KeyboardEvent, type ReactElement, useRef } from "react";

import { cn } from "@/lib/utils";

const PIN_LENGTH = 6;

interface PinCodeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  autoComplete?: "current-password" | "new-password" | "off";
}

export function PinCodeInput({ id, label, value, onChange, autoFocus = false, autoComplete = "off" }: PinCodeInputProps): ReactElement {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: PIN_LENGTH }, (_, index) => value[index] ?? "");

  function update(nextDigits: string[]): void {
    onChange(nextDigits.join("").replace(/\D/g, "").slice(0, PIN_LENGTH));
  }

  function fillFrom(index: number, rawValue: string): void {
    const incoming = rawValue.replace(/\D/g, "").slice(0, PIN_LENGTH - index).split("");
    if (incoming.length === 0) return;
    const nextDigits = [...digits];
    incoming.forEach((digit, offset) => { nextDigits[index + offset] = digit; });
    update(nextDigits);
    inputRefs.current[Math.min(index + incoming.length, PIN_LENGTH - 1)]?.focus();
  }

  function handleChange(index: number, rawValue: string): void {
    if (rawValue.length > 1) {
      fillFrom(index, rawValue);
      return;
    }
    const digit = rawValue.replace(/\D/g, "");
    const nextDigits = [...digits];
    nextDigits[index] = digit;
    update(nextDigits);
    if (digit && index < PIN_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      const nextDigits = [...digits];
      nextDigits[index - 1] = "";
      update(nextDigits);
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < PIN_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    fillFrom(index, event.clipboardData.getData("text"));
  }

  return (
    <div aria-label={label} className="flex w-fit max-w-full gap-2" data-pin-code={id} role="group">
      {digits.map((digit, index) => (
        <input
          aria-label={`${label}, số ${index + 1}`}
          autoComplete={index === 0 ? autoComplete : "off"}
          autoFocus={autoFocus && index === 0}
          className={cn("size-10 shrink-0 rounded-md border border-input bg-background text-center text-lg font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-12", digit ? "text-foreground" : "text-muted-foreground")}
          id={index === 0 ? id : undefined}
          inputMode="numeric"
          key={index}
          maxLength={1}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          pattern="[0-9]*"
          ref={(element) => { inputRefs.current[index] = element; }}
          type="password"
          value={digit}
        />
      ))}
    </div>
  );
}