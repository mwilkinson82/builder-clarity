export const COMPANY_ASSET_BUCKET = "company-assets";

export function companyLogoPath(organizationId: string) {
  return `${organizationId}/logo`;
}

export function versionAssetUrl(url: string, version: string | number | undefined) {
  if (!url || version === undefined || version === "") return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(String(version))}`;
}
