import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";

import { renderQrPngInTerminal } from "./qr-image-terminal.js";

test("renders the supplied QR PNG pixels without recreating a QR payload", () => {
  const png = new PNG({ width: 4, height: 4 });
  const blackPixels = new Set([0, 1, 4, 5, 10, 11]);
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const offset = pixel * 4;
    const value = blackPixels.has(pixel) ? 0 : 255;
    png.data[offset] = value;
    png.data[offset + 1] = value;
    png.data[offset + 2] = value;
    png.data[offset + 3] = 255;
  }

  const terminalQr = renderQrPngInTerminal(PNG.sync.write(png).toString("base64"));

  assert.equal(terminalQr, "██  \n  ▀▀");
  assert.equal(renderQrPngInTerminal(`data:image/png;base64,${PNG.sync.write(png).toString("base64")}`), terminalQr);
});
