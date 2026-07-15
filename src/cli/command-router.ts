import { Command } from "commander";

export type CommandHandler = (argv?: string[]) => Promise<void> | void;

export interface CliCommandSpec {
  name: string;
  description: string;
  handler: CommandHandler;
  hidden?: boolean;
  children?: CliCommandSpec[];
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
    .action(async () => {
      await spec.handler(argv);
    });

  for (const child of spec.children ?? []) {
    registerCommand(command, child, argv);
  }

  return command;
}
