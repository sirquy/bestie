import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { AppConfig, WorkspaceExternalPathAccess, WorkspaceExternalPathConfig } from "./config.js";
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

  if (isInsidePath(resolvedPath, workspacePath) || (options.access === "read" && isInsidePath(resolvedPath, options.paths.rootDir))) {
    return resolvedPath;
  }

  const externalRoot = findAllowedExternalRoot(options.config, options.paths, resolvedPath);
  if (externalRoot) {
    return resolvedPath;
  }

  throw new Error(`Path is outside the project, agent workspace, and configured external ${options.access} paths.`);
}

export async function resolveSandboxPath(options: { config?: AppConfig; paths: RuntimePaths; inputPath: string; defaultBase: "root" | "workspace"; access: WorkspaceAccess }): Promise<string> {
  const workspacePath = getAgentWorkspacePath(options.config, options.paths);
  const basePath = options.defaultBase === "workspace" ? workspacePath : options.paths.rootDir;
  const resolvedPath = isAbsolute(options.inputPath) ? resolve(options.inputPath) : resolve(basePath, options.inputPath);
  const allowedRoot = findAllowedRootForAccess(options.config, options.paths, resolvedPath, options.access);

  if (!allowedRoot) {
    throw new Error(`Path is outside the project, agent workspace, and configured external ${options.access} paths.`);
  }

  if (!(await isRealPathInsideAllowedRoot(resolvedPath, allowedRoot, options.access))) {
    throw new Error(`Path resolves outside the project, agent workspace, and configured external ${options.access} paths.`);
  }

  return resolvedPath;
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
    const resolvedExternalPath = resolveAgainstRoot(paths, externalPathValue(externalPath));
    if (isInsidePath(absolutePath, resolvedExternalPath)) {
      return absolutePath;
    }
  }

  return absolutePath;
}

function findAllowedExternalRoot(config: AppConfig | undefined, paths: RuntimePaths, absolutePath: string): string | undefined {
  for (const externalPath of config?.workspace?.externalPaths ?? []) {
    const resolvedExternalPath = resolveAgainstRoot(paths, externalPathValue(externalPath));
    if (isInsidePath(absolutePath, resolvedExternalPath)) {
      return resolvedExternalPath;
    }
  }

  return undefined;
}

function findAllowedRootForAccess(config: AppConfig | undefined, paths: RuntimePaths, absolutePath: string, access: WorkspaceAccess): string | undefined {
  const workspacePath = getAgentWorkspacePath(config, paths);
  if (isInsidePath(absolutePath, workspacePath)) {
    return workspacePath;
  }
  if (access === "read" && isInsidePath(absolutePath, paths.rootDir)) {
    return paths.rootDir;
  }
  return findAllowedExternalRootForAccess(config, paths, absolutePath, access);
}

function findAllowedExternalRootForAccess(config: AppConfig | undefined, paths: RuntimePaths, absolutePath: string, access: WorkspaceAccess): string | undefined {
  for (const externalPath of config?.workspace?.externalPaths ?? []) {
    if (!externalPathAllowsAccess(externalPath, access)) {
      continue;
    }
    const resolvedExternalPath = resolveAgainstRoot(paths, externalPathValue(externalPath));
    if (isInsidePath(absolutePath, resolvedExternalPath)) {
      return resolvedExternalPath;
    }
  }

  return undefined;
}

async function isRealPathInsideAllowedRoot(candidatePath: string, allowedRoot: string, access: WorkspaceAccess): Promise<boolean> {
  const [realCandidate, realRoot] = await Promise.all([
    realExistingPathForAccess(candidatePath, access),
    realExistingPathForAccess(allowedRoot, "write"),
  ]);

  if (!realCandidate || !realRoot) {
    return true;
  }

  return isInsidePath(realCandidate, realRoot);
}

async function realExistingPathForAccess(path: string, access: WorkspaceAccess): Promise<string | undefined> {
  if (await pathExists(path)) {
    return realpath(path);
  }
  if (access === "read") {
    return undefined;
  }

  let parent = dirname(path);
  while (parent && parent !== dirname(parent)) {
    if (await pathExists(parent)) {
      return realpath(parent);
    }
    parent = dirname(parent);
  }

  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function externalPathValue(value: WorkspaceExternalPathConfig): string {
  return typeof value === "string" ? value : value.path;
}

function externalPathAllowsAccess(value: WorkspaceExternalPathConfig, access: WorkspaceAccess): boolean {
  const configuredAccess: WorkspaceExternalPathAccess = typeof value === "string" ? "readwrite" : value.access ?? "readwrite";
  return configuredAccess === "readwrite" || configuredAccess === access;
}

function resolveAgainstRoot(paths: RuntimePaths, inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(paths.rootDir, inputPath);
}

function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
