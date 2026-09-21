import type { JobHandler, JobPayloads, JobType } from "../types";
import { analyzeWebsiteJob, onWebsiteAnalyzeFailure } from "./website-analyze";
import { ingestDocumentJob, onDocumentIngestFailure } from "./document-ingest";
import { searchLeadsJob, onLeadSearchFailure } from "./lead-search";
import { enrichLeadJob, onLeadEnrichFailure } from "./lead-enrich";
import { scoreLeadsJob, onLeadScoreFailure } from "./lead-score";

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
  "lead.search": { run: searchLeadsJob, onFailure: onLeadSearchFailure },
  "lead.enrich": { run: enrichLeadJob, onFailure: onLeadEnrichFailure },
  "lead.score": { run: scoreLeadsJob, onFailure: onLeadScoreFailure },
};
