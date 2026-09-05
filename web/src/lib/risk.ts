export function formatRiskLabel(risk: string, mediumLabel = "cần cân nhắc"): string {
  if (risk === "high") return "rủi ro cao";
  if (risk === "medium") return mediumLabel;
  if (risk === "low") return "rủi ro thấp";
  return risk;
}
