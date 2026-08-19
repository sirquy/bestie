import { PNG } from "pngjs";

export function renderQrPngInTerminal(imageBase64: string): string {
  const normalizedImage = imageBase64.replace(/^data:image\/png;base64,/i, "");
  const png = PNG.sync.read(Buffer.from(normalizedImage, "base64"));
  const pixels = toMonochromePixels(png.data, png.width, png.height);
  const scale = detectScale(pixels);
  const modules = sampleModules(pixels, scale);
  return modulesToTerminal(modules);
}

function toMonochromePixels(data: Buffer, width: number, height: number): boolean[][] {
  const pixels: boolean[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 255;
      const luminance = ((data[offset] ?? 255) * 0.2126) + ((data[offset + 1] ?? 255) * 0.7152) + ((data[offset + 2] ?? 255) * 0.0722);
      row.push(alpha > 127 && luminance < 128);
    }
    pixels.push(row);
  }
  return pixels;
}

function detectScale(pixels: boolean[][]): number {
  let scale = 0;
  for (const line of [...pixels, ...transpose(pixels)]) {
    let runLength = 1;
    for (let index = 1; index <= line.length; index += 1) {
      if (index < line.length && line[index] === line[index - 1]) {
        runLength += 1;
        continue;
      }
      scale = scale === 0 ? runLength : greatestCommonDivisor(scale, runLength);
      runLength = 1;
    }
  }
  return scale || 1;
}

function transpose(rows: boolean[][]): boolean[][] {
  const width = rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, column) => rows.map((row) => row[column] ?? false));
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function sampleModules(pixels: boolean[][], scale: number): boolean[][] {
  const height = Math.ceil(pixels.length / scale);
  const width = Math.ceil((pixels[0]?.length ?? 0) / scale);
  return Array.from({ length: height }, (_, moduleY) => Array.from({ length: width }, (_, moduleX) => pixels[moduleY * scale]?.[moduleX * scale] ?? false));
}

function modulesToTerminal(modules: boolean[][]): string {
  const lines: string[] = [];
  for (let rowIndex = 0; rowIndex < modules.length; rowIndex += 2) {
    const top = modules[rowIndex] ?? [];
    const bottom = modules[rowIndex + 1] ?? [];
    lines.push(top.map((isTopBlack, column) => {
      const isBottomBlack = bottom[column] ?? false;
      if (isTopBlack && isBottomBlack) return "█";
      if (isTopBlack) return "▀";
      if (isBottomBlack) return "▄";
      return " ";
    }).join(""));
  }
  return lines.join("\n");
}
