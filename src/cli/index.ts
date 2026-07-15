#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CommanderError, type Command } from "commander";

import { createCliProgram } from "./command-router.js";
import { cliCommandSpecs, cliHelpDetails } from "./command-specs.js";
import { badge, dim } from "./ui.js";

const bannerText = String.raw`
 ____            _   _            _                    _   
| __ )  ___  ___| |_(_) ___      / \   __ _  ___ _ __ | |_ 
|  _ \ / _ \/ __| __| |/ _ \    / _ \ / _' |/ _ \ '_ \| __|
| |_) |  __/\__ \ |_| |  __/   / ___ \ (_| |  __/ | | | |_ 
|____/ \___||___/\__|_|\___|  /_/   \_\__, |\___|_| |_|\__|
                                      |___/                 
`;

export async function main(argv: string[]): Promise<void> {
  await showBanner(argv);

  if (!argv[2]) {
    console.log(createProgram(argv).helpInformation().trimEnd());
    return;
  }

  try {
    await createProgram(argv).parseAsync(argv, { from: "node" });
  } catch (error) {
    if (error instanceof CommanderError) {
      handleCommanderError(error, argv[2]);
      return;
    }

    throw error;
  }
}

function createProgram(argv: string[]): Command {
  return createCliProgram({
    argv,
    commands: cliCommandSpecs,
    description: "Local-first Bestie agent CLI",
    helpDetails: cliHelpDetails,
    name: "bestie",
    usage: "<command>",
    writeOut: console.log,
    writeErr: console.error,
  });
}

function handleCommanderError(error: CommanderError, command?: string): void {
  if (error.code === "commander.helpDisplayed") {
    return;
  }

  if (command === "telegram" || command === "zalo") {
    console.error(`${badge("MOVED", "yellow")} Channel commands now live under \`bestie channels ${command}\`.`);
    console.error(`${dim("Next")} Run \`bestie channels ${command} --help\` to see available options.`);
    process.exitCode = 1;
    return;
  }

  if (error.code === "commander.unknownCommand") {
    console.error(`${badge("ERROR", "red")} ${error.message}`);
    console.error(`${dim("Next")} Run \`bestie --help\` to see available commands.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = error.exitCode;
}

async function showBanner(argv: string[]): Promise<void> {
  if (shouldSuppressBanner(argv)) {
    return;
  }

  if (!shouldAnimateBanner()) {
    console.log(bannerText);
    return;
  }

  await animateBanner(bannerText);
}

function shouldAnimateBanner(): boolean {
  if (process.env.BESTIE_BANNER === "static") {
    return false;
  }
  if (process.env.BESTIE_BANNER === "animate") {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

async function animateBanner(text: string): Promise<void> {
  const frames = [".", "o", "O", "@"];
  const lines = text.trimEnd().split("\n");

  for (let frame = 0; frame < frames.length; frame += 1) {
    const glyph = frames[frame] ?? "@";
    const rendered = lines.map((line) => line.replace(/[^\s]/g, glyph)).join("\n");
    process.stdout.write(`${rendered}\n`);
    await sleep(28);
    process.stdout.write(`\x1b[${lines.length}A\x1b[J`);
  }

  console.log(bannerText);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shouldSuppressBanner(argv: string[]): boolean {
  const command = argv[2];
  if (process.env.BESTIE_NO_BANNER === "1") {
    return true;
  }
  if (command === "doctor" && argv.includes("--json")) {
    return true;
  }
  if (command === "channels" && argv[3] === "doctor" && argv.includes("--json")) {
    return true;
  }
  if (command === "mcp" && argv[3] === "call" && argv.includes("--json")) {
    return true;
  }
  if (command === "memory" && argv[3] === "export") {
    return true;
  }

  return false;
}

if (isCliEntrypoint()) {
  main(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected CLI error.";
    console.error(message);
    process.exitCode = 1;
  });
}

function isCliEntrypoint(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href : false;
}
