import type { LeadSearchQuery } from "@/server/providers/lead-source/types";

export interface JobPayloads {
  "website.analyze": { analysisId: string; usageId?: string };
  "document.ingest": { documentId: string; usageId?: string };
  /** Doğal dil lead araması. `runId` ilk denemede yazılır; tekrar denemede yeni (ücretli) çalıştırma başlatılmaz. */
  "lead.search": {
    prompt: string;
    interpretation: string;
    query: LeadSearchQuery;
    usageId?: string;
    reserved: number;
    runId?: string;
  };
  /** Lead web sitesi araştırması + ardından puanlama (tek işlem, "AI ile Analiz Et") */
  "lead.enrich": { leadId: string; usageId?: string };
  /** Toplu puanlama (araştırma yapmadan, mevcut veriyle) */
  "lead.score": { leadIds: string[]; usageId?: string };
  /** Kampanya stratejisi (AI) — sonuç PENDING, insan onayı bekler */
  "campaign.strategy": { campaignId: string; usageId?: string };
  /** Kampanya ilk temas mesajları (AI) — her mesaj PENDING_APPROVAL */
  "campaign.generate_messages": { campaignId: string; leadIds: string[]; usageId?: string };
  /** Onaylı mesajların gönderimi (günlük sınır, uyum ve engel kontrolü her mesajda tekrar yapılır) */
  "campaign.send": { campaignId: string };
}

export type JobType = keyof JobPayloads;

export interface JobHelpers {
  jobId: string;
  companyId: string | null;
  createdById: string | null;
  isFinalAttempt: boolean;
  progress(pct: number): Promise<void>;
}

export type JobHandler<T extends JobType> = (payload: JobPayloads[T], helpers: JobHelpers) => Promise<unknown>;

/**
 * Tekrar denenmemesi gereken hata (ör. geçersiz URL, robots.txt yasağı, yetersiz kredi).
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
