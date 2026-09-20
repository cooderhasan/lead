import type { JobHandler, JobPayloads, JobType } from "../types";
import { analyzeWebsiteJob, onWebsiteAnalyzeFailure } from "./website-analyze";
import { ingestDocumentJob, onDocumentIngestFailure } from "./document-ingest";

type Registry = {
  [K in JobType]: {
    run: JobHandler<K>;
    /** Son deneme de başarısız olduğunda çağrılır (ör. kredi iadesi, durum güncelleme). */
    onFailure?: (payload: JobPayloads[K], error: string) => Promise<void>;
  };
};

export const handlers: Registry = {
  "website.analyze": { run: analyzeWebsiteJob, onFailure: onWebsiteAnalyzeFailure },
  "document.ingest": { run: ingestDocumentJob, onFailure: onDocumentIngestFailure },
};
