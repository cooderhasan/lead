export interface JobPayloads {
  "website.analyze": { analysisId: string; usageId?: string };
  "document.ingest": { documentId: string; usageId?: string };
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
