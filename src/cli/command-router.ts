import { Command } from "commander";

export type CommandHandler = (argv?: string[]) => Promise<void> | void;

export interface CliCommandSpec {
  name: string;
  description: string;
  handler: CommandHandler;
  hidden?: boolean;
  options?: CliCommandOptionSpec[];
  children?: CliCommandSpec[];
}

export interface CliCommandOptionSpec {
  flags: string;
  description: string;
  name: string;
}

interface CliProgramOptions {
  argv: string[];
  commands: CliCommandSpec[];
  description: string;
  helpDetails?: string;
  name: string;
  usage: string;
  writeOut: (message: string) => void;
  writeErr: (message: string) => void;
}

export function createCliProgram(options: CliProgramOptions): Command {
  const program = new Command();

  program
    .name(options.name)
    .usage(options.usage)
    .description(options.description)
    .helpOption("-h, --help", "Show this help")
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({
      writeOut: (message) => options.writeOut(message.trimEnd()),
      writeErr: (message) => options.writeErr(message.trimEnd()),
    });

  if (options.helpDetails) {
    program.addHelpText("after", options.helpDetails);
  }

  for (const command of options.commands) {
    registerCommand(program, command, options.argv);
  }

  return program;
}

function registerCommand(parent: Command, spec: CliCommandSpec, argv: string[]): Command {
  const command = parent
    .command(spec.name, { hidden: spec.hidden ?? false })
    .description(spec.description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...args: unknown[]) => {
      const actionCommand = args[args.length - 1] instanceof Command ? args[args.length - 1] as Command : command;
      await spec.handler([...argv, ...buildOptionArgv(spec.options ?? [], actionCommand.opts<Record<string, unknown>>())]);
    });

  for (const option of spec.options ?? []) {
    command.option(option.flags, option.description);
  }

  for (const child of spec.children ?? []) {
    registerCommand(command, child, argv);
  }

  return command;
}

function buildOptionArgv(options: CliCommandOptionSpec[], values: Record<string, unknown>): string[] {
  const argv: string[] = [];
  for (const option of options) {
    const value = values[option.name];
    if (value === undefined) {
      continue;
    }
    const flag = option.flags.split(/[ ,|]+/).find((part) => part.startsWith("--"))?.replace(/[ <[].*$/, "");
    if (!flag) {
      continue;
    }
    argv.push(flag);
    if (typeof value !== "boolean") {
      argv.push(String(value));
    }
  }

  return argv;
}
