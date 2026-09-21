import "server-only";
import { env } from "@/server/env";
import { ApifyLeadSourceProvider } from "./apify";
import type { LeadSourceProvider } from "./types";

let override: LeadSourceProvider | null = null;

/** Yalnızca testlerde kullanılır. Production kodu bunu çağırmaz. */
export function __setLeadSourceProviderForTests(p: LeadSourceProvider | null) {
  override = p;
}

export function isLeadSourceConfigured(): boolean {
  return Boolean(override) || Boolean(env().APIFY_TOKEN);
}

/** Otomatik lead arama sağlayıcısı. Yapılandırılmamışsa anlaşılır Türkçe hata fırlatır. */
export function getLeadSourceProvider(): LeadSourceProvider {
  if (override) return override;
  const e = env();
  return new ApifyLeadSourceProvider(e.APIFY_TOKEN ?? "", e.APIFY_GOOGLE_MAPS_ACTOR);
}
