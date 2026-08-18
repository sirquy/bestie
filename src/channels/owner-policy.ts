export type OwnerUserIdConfig = string | string[];

export function hasConfiguredOwner(ownerUserId: OwnerUserIdConfig | undefined): boolean {
  return typeof ownerUserId === "string" ? ownerUserId.trim().length > 0 : Boolean(ownerUserId?.length);
}

export function isWildcardOwner(ownerUserId: OwnerUserIdConfig | undefined): boolean {
  return Array.isArray(ownerUserId) && ownerUserId.length === 1 && ownerUserId[0]?.trim() === "*";
}

export function configuredOwnerIds(ownerUserId: OwnerUserIdConfig | undefined): string[] {
  if (isWildcardOwner(ownerUserId)) {
    return [];
  }

  return typeof ownerUserId === "string" ? (ownerUserId.trim() ? [ownerUserId] : []) : ownerUserId ?? [];
}

export function matchesOwnerId(ownerUserId: OwnerUserIdConfig | undefined, candidateIds: readonly string[]): boolean {
  const nonEmptyCandidateIds = candidateIds.filter((candidateId) => candidateId.trim().length > 0);
  if (isWildcardOwner(ownerUserId)) {
    return nonEmptyCandidateIds.length > 0;
  }

  const owners = typeof ownerUserId === "string" ? [ownerUserId] : ownerUserId ?? [];
  return nonEmptyCandidateIds.some((candidateId) => owners.includes(candidateId));
}
