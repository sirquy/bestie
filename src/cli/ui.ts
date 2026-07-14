import { stdout as output } from "node:process";

export type UiColor = "cyan" | "green" | "magenta" | "red" | "yellow" | "blue" | "gray";

const colorCodes: Record<UiColor, number> = {
  cyan: 36,
  green: 32,
  magenta: 35,
  red: 31,
  yellow: 33,
  blue: 34,
  gray: 90,
};

export function supportsColor(): boolean {
  return Boolean(output.isTTY && !process.env.NO_COLOR);
}

export function color(name: UiColor, value: string): string {
  if (!supportsColor()) {
    return value;
  }

  return `\x1b[${colorCodes[name]}m${value}\x1b[0m`;
}

export function bold(value: string): string {
  return supportsColor() ? `\x1b[1m${value}\x1b[0m` : value;
}

export function dim(value: string): string {
  return supportsColor() ? `\x1b[2m${value}\x1b[0m` : value;
}

export function badge(label: string, colorName: UiColor = "cyan"): string {
  return color(colorName, `[${label}]`);
}

export function title(value: string): string {
  return `${bold(color("magenta", value))}`;
}

export function keyValue(key: string, value: string): string {
  return `${dim(key.padEnd(14))} ${value}`;
}

export function rule(width = 64): string {
  return dim("-".repeat(width));
}

export function statusBadge(status: "pass" | "warn" | "fail" | "info"): string {
  if (status === "pass") return badge("PASS", "green");
  if (status === "warn") return badge("WARN", "yellow");
  if (status === "fail") return badge("FAIL", "red");
  return badge("INFO", "cyan");
}

export interface Spinner {
  stop: (finalMessage?: string) => void;
}

export function startSpinner(message: string): Spinner {
  if (!output.isTTY) {
    return { stop: (finalMessage) => finalMessage ? console.log(finalMessage) : undefined };
  }

  const frames = ["-", "\\", "|", "/"];
  let frame = 0;
  const render = () => {
    output.write(`\r${color("yellow", frames[frame % frames.length] ?? "-")} ${dim(message)}   `);
    frame += 1;
  };

  render();
  const timer = setInterval(render, 90);

  return {
    stop: (finalMessage) => {
      clearInterval(timer);
      output.write("\r\x1b[2K");
      if (finalMessage) {
        console.log(finalMessage);
      }
    },
  };
}