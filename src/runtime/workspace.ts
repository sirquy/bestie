import { isAbsolute, relative, resolve } from "node:path";

import type { AppConfig } from "./config.js";
import type { RuntimePaths } from "./paths.js";

export type WorkspaceAccess = "read" | "write";

export function getAgentWorkspacePath(config: AppConfig | undefined, paths: RuntimePaths): string {
  const configuredPath = config?.workspace?.defaultPath;
  return configuredPath ? resolveAgainstRoot(paths, configuredPath) : paths.workspaceDir;
}

export function resolveWorkspacePath(options: { config?: AppConfig; paths: RuntimePaths; inputPath: string; defaultBase: "root" | "workspace"; access: WorkspaceAccess }): string {
  const workspacePath = getAgentWorkspacePath(options.config, options.paths);
  const basePath = options.defaultBase === "workspace" ? workspacePath : options.paths.rootDir;
  const resolvedPath = isAbsolute(options.inputPath) ? resolve(options.inputPath) : resolve(basePath, options.inputPath);

  if (isInsidePath(resolvedPath, workspacePath) || isInsidePath(resolvedPath, options.paths.rootDir)) {
    return resolvedPath;
  }

  const externalRoot = findAllowedExternalRoot(options.config, options.paths, resolvedPath);
  if (externalRoot) {
    return resolvedPath;
  }

  throw new Error(`Path is outside the project, agent workspace, and configured external ${options.access} paths.`);
}

export function formatWorkspaceRelativePath(config: AppConfig | undefined, paths: RuntimePaths, absolutePath: string): string {
  const workspacePath = getAgentWorkspacePath(config, paths);
  if (isInsidePath(absolutePath, workspacePath)) {
    return relative(workspacePath, absolutePath) || ".";
  }
  if (isInsidePath(absolutePath, paths.rootDir)) {
    return relative(paths.rootDir, absolutePath) || ".";
  }

  for (const externalPath of config?.workspace?.externalPaths ?? []) {
    const resolvedExternalPath = resolveAgainstRoot(paths, externalPath);
    if (isInsidePath(absolutePath, resolvedExternalPath)) {
      return absolutePath;
    }
  }

  return absolutePath;
}

function findAllowedExternalRoot(config: AppConfig | undefined, paths: RuntimePaths, absolutePath: string): string | undefined {
  for (const externalPath of config?.workspace?.externalPaths ?? []) {
    const resolvedExternalPath = resolveAgainstRoot(paths, externalPath);
    if (isInsidePath(absolutePath, resolvedExternalPath)) {
      return resolvedExternalPath;
    }
  }

  return undefined;
}

function resolveAgainstRoot(paths: RuntimePaths, inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(paths.rootDir, inputPath);
}

function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
