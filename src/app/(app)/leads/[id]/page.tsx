import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, HelpCircle, Radar, Trash2 } from "lucide-react";
import { requireTenantPage } from "@/server/tenancy/context";
import { can } from "@/server/tenancy/permissions";
import { isAIConfigured } from "@/server/ai";
import { getLead, LEAD_STATUS_LABELS } from "@/server/services/leads";
import { getActiveLeadJob, getLastLeadJobError, type LeadEnrichment } from "@/server/services/lead-intelligence";
import { deleteLeadAction, updateLeadStatusAction } from "@/app/actions/leads";
import { JobPoller } from "@/components/job-poller";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Select } from "@/components/ui";
import { isAppError } from "@/lib/errors";
import { LEAD_STATUSES } from "@/lib/validation";
import { SCORE_LABELS, SCORE_MAX, scoreTone, type ScoreKey } from "@/lib/lead-scoring";
import { ResearchLeadButton, ScoreLeadsButton } from "../lead-forms";

export const metadata: Metadata = { title: "Lead" };

const SIGNAL_LABELS: Record<string, string> = {
  NEW_FACILITY: "Yeni tesis",
  NEW_PRODUCTION_LINE: "Yeni üretim hattı",
  CAPACITY_EXPANSION: "Kapasite artışı",
  NEW_PRODUCT: "Yeni ürün",
  HIRING: "Personel alımı",
  INVESTMENT: "Yatırım",
  NEW_CUSTOMER: "Yeni müşteri",
  EXPORT_EXPANSION: "İhracat",
  MACHINE_INVESTMENT: "Makine yatırımı",
  LINE_CHANGE: "Hat değişikliği",
  SUPPLIER_SEARCH: "Tedarikçi arayışı",
  TENDER: "İhale",
  SOCIAL_ANNOUNCEMENT: "Duyuru",
  WEBSITE_CHANGE: "Site değişikliği",
  OTHER: "Diğer",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  GOOGLE_MAPS: "Google Haritalar",
  COMPANY_WEBSITE: "Firma sitesi",
  CSV_IMPORT: "CSV",
  MANUAL: "Elle",
  WEB_SEARCH: "Web araması",
  DIRECTORY: "Dizin",
  PUBLIC_REGISTRY: "Resmi kayıt",
  INSTAGRAM: "Instagram",
  THIRD_PARTY_DATA: "3. taraf veri",
};

const fmtDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(d) : "—");

function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage();
  const { id } = await params;
  let lead;
  try {
    lead = await getLead(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [activeJob, lastError] = await Promise.all([getActiveLeadJob(ctx, id), getLastLeadJobError(ctx, id)]);
  const canWrite = can(ctx, "lead.write");
  const aiReady = isAIConfigured();
  const score = lead.scores[0];
  const enrichment = (lead.enrichment ?? null) as LeadEnrichment | null;
  const scoreFacts = (score?.verifiedFacts ?? null) as { facts?: string[]; matchedProducts?: string[] } | null;
  const scoreAssumptions = (Array.isArray(score?.assumptions) ? score.assumptions : []) as string[];
  const website = safeHref(lead.website);

  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-text-2 hover:text-text">
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>
      <PageHeader
        title={lead.companyName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-accent">
                {lead.domain ?? lead.website} <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
            {[lead.district, lead.city, lead.country].filter(Boolean).join(", ")}
            {lead.industry && <Badge>{lead.industry}</Badge>}
          </span>
        }
        actions={
          canWrite ? (
            <form action={updateLeadStatusAction} className="flex gap-2">
              <input type="hidden" name="id" value={lead.id} />
              <Select name="status" defaultValue={lead.status} className="w-44" aria-label="Durum">
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                ))}
              </Select>
              <Button type="submit" variant="secondary">Kaydet</Button>
            </form>
          ) : (
            <Badge>{LEAD_STATUS_LABELS[lead.status]}</Badge>
          )
        }
      />

      {activeJob && (
        <div className="mb-6">
          <JobPoller
            jobId={activeJob.id}
            label={activeJob.type === "lead.enrich" ? "AI firmayı araştırıyor…" : "Puanlanıyor…"}
            steps={[[0, "Web sitesi okunuyor…"], [35, "Bilgiler çıkarılıyor…"], [65, "Kanıtlar kaynakla karşılaştırılıyor…"], [75, "Puanlanıyor…"]]}
          />
        </div>
      )}
      {!activeJob && lastError && !enrichment && (
        <Alert tone="warning" className="mb-6">Son analiz tamamlanamadı: {lastError.error} Kredi iade edildi.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Skor kartı */}
          <Card>
            <CardHeader
              title="Uygunluk puanı"
              description={score ? `${fmtDate(score.createdAt)} · ${score.model ?? "AI"}` : "Henüz puanlanmadı"}
              action={
                score ? (
                  <span className="text-3xl font-semibold tracking-tight">
                    <Badge tone={scoreTone(score.total)} className="px-3 py-1 text-lg">{score.total}</Badge>
                    <span className="ml-1 text-sm text-text-3">/100</span>
                  </span>
                ) : undefined
              }
            />
            <CardBody className="flex flex-col gap-4">
              {score ? (
                <>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {(Object.keys(SCORE_MAX) as ScoreKey[]).map((k) => {
                      const value = score[k];
                      const max = SCORE_MAX[k];
                      return (
                        <li key={k}>
                          <div className="flex justify-between text-xs">
                            <span className="text-text-2">{SCORE_LABELS[k]}</span>
                            <span className="font-medium text-text">{value}/{max}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${(value / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-sm leading-relaxed text-text">{score.explanation}</p>
                  {scoreFacts?.matchedProducts && scoreFacts.matchedProducts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-text-2">Uygun ürünleriniz:</span>
                      {scoreFacts.matchedProducts.map((p) => (
                        <Badge key={p} tone="accent">{p}</Badge>
                      ))}
                    </div>
                  )}
                  {scoreAssumptions.length > 0 && (
                    <details className="text-xs text-text-2">
                      <summary className="cursor-pointer">Puandaki varsayımlar ({scoreAssumptions.length})</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {scoreAssumptions.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-2">
                  Puan; ürün uyumu, sektör, ölçek, satın alma sinyali ve ulaşılabilirliğe göre hesaplanır. Kanıt olmayan alt skorlar sınırlandırılır.
                </p>
              )}
              {canWrite && aiReady && !activeJob && (
                <div className="flex flex-wrap gap-3">
                  {lead.website && <ResearchLeadButton leadId={lead.id} hasWebsite />}
                  <ScoreLeadsButton leadIds={[lead.id]} label={score ? "Yeniden puanla (1 kredi)" : "Yalnızca puanla (1 kredi)"} />
                </div>
              )}
              {canWrite && !aiReady && <Alert tone="neutral">AI yapılandırılmadığı için araştırma ve puanlama kapalı.</Alert>}
            </CardBody>
          </Card>

          {/* Doğrulanmış vs varsayım */}
          <Card>
            <CardHeader
              title="Firma hakkında"
              description={
                enrichment
                  ? `Kaynak: ${enrichment.pages.length} sayfa · ${fmtDate(new Date(enrichment.researchedAt))}`
                  : "Henüz araştırılmadı. \"AI ile Analiz Et\" firmanın web sitesini okur."
              }
            />
            <CardBody className="flex flex-col gap-4">
              {lead.aiSummary && <p className="text-sm leading-relaxed text-text">{lead.aiSummary}</p>}
              {enrichment && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-success">
                      <CheckCircle2 className="size-4" aria-hidden /> Doğrulanmış ({enrichment.verified.length})
                    </h3>
                    {enrichment.verified.length === 0 ? (
                      <p className="text-xs text-text-3">Sayfada kanıtı bulunan bilgi yok.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {enrichment.verified.map((v, i) => (
                          <li key={i} className="rounded-lg border border-border p-2.5">
                            <p className="text-text">{v.statement}</p>
                            {v.evidence && <p className="mt-1 text-xs italic text-text-3">&ldquo;{v.evidence}&rdquo;</p>}
                            {safeHref(v.sourceUrl) && (
                              <a href={safeHref(v.sourceUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block truncate text-xs text-accent-text">
                                Kaynak
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                      <HelpCircle className="size-4" aria-hidden /> AI varsayımı ({enrichment.assumptions.length})
                    </h3>
                    {enrichment.assumptions.length === 0 ? (
                      <p className="text-xs text-text-3">Varsayım yok.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {enrichment.assumptions.map((a, i) => (
                          <li key={i} className="rounded-lg border border-dashed border-border p-2.5">
                            <p className="text-text">{a.statement}</p>
                            <p className="mt-1 text-xs text-text-3">{a.reason}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {enrichment && enrichment.products.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="text-text-2">Ürünleri:</span>
                  {enrichment.products.map((p) => <Badge key={p}>{p}</Badge>)}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Sinyaller */}
          <Card>
            <CardHeader title="Satış sinyalleri" description="Yalnızca kaynağında kanıtı bulunan gelişmeler gösterilir." />
            {lead.signals.length === 0 ? (
              <EmptyState icon={<Radar className="size-7" />} title="Sinyal yok" description="Araştırma sırasında yatırım, yeni tesis, personel alımı gibi gelişmeler bulunursa burada görünür." />
            ) : (
              <ol className="divide-y divide-border">
                {lead.signals.map((s) => (
                  <li key={s.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{SIGNAL_LABELS[s.type] ?? s.type}</Badge>
                      <span className="text-sm font-medium text-text">{s.title}</span>
                      <span className="ml-auto text-xs text-text-3">{fmtDate(s.publishedAt ?? s.detectedAt)}</span>
                    </div>
                    {s.description && <p className="mt-1 text-sm text-text-2">{s.description}</p>}
                    {s.aiInterpretation && <p className="mt-1 text-xs italic text-text-3">{s.aiInterpretation}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* Yan panel */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Kurumsal iletişim" />
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-text-2">Telefon</dt>
                <dd className="truncate text-text">{lead.phone ?? "—"}</dd>
                <dt className="text-text-2">E-posta</dt>
                <dd className="truncate text-text">{lead.genericEmail ?? "—"}</dd>
                <dt className="text-text-2">Adres</dt>
                <dd className="text-text">{lead.address ?? "—"}</dd>
                <dt className="text-text-2">Çalışan</dt>
                <dd className="text-text">
                  {lead.employeeCountMin || lead.employeeCountMax
                    ? [lead.employeeCountMin, lead.employeeCountMax].filter(Boolean).join("–")
                    : "Bilinmiyor"}
                </dd>
                {(lead.linkedin || lead.instagram) && (
                  <>
                    <dt className="text-text-2">Sosyal</dt>
                    <dd className="flex flex-wrap gap-2">
                      {safeHref(lead.linkedin) && <a href={safeHref(lead.linkedin)!} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-text">LinkedIn</a>}
                      {safeHref(lead.instagram) && <a href={safeHref(lead.instagram)!} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-text">Instagram</a>}
                    </dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Kişiler (${lead.contacts.length})`} description="Kişisel veriler ayrı tutulur; iletişim dayanağı olmadan gönderim yapılmaz." />
            {lead.contacts.length === 0 ? (
              <CardBody><p className="text-sm text-text-3">Kayıtlı kişi yok.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {lead.contacts.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <p className="font-medium text-text">{c.fullName ?? c.email ?? c.phone}</p>
                    <p className="text-xs text-text-2">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{c.type === "PERSONAL" ? "Kişisel" : "Kurumsal"}</Badge>
                      {c.communicationBasis === "NONE" && <Badge tone="warning">Dayanak yok</Badge>}
                      {c.optOut && <Badge tone="danger">İletişim istemiyor</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Kaynaklar" />
            <ul className="divide-y divide-border">
              {lead.sources.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                  <Badge>{SOURCE_TYPE_LABELS[s.type] ?? s.type}</Badge>
                  <span className="flex-1 text-xs text-text-3">{fmtDate(s.fetchedAt)}</span>
                  {safeHref(s.sourceUrl) && (
                    <a href={safeHref(s.sourceUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-text" aria-label="Kaynağı aç">
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-border text-xs text-text-3">
              Bulunma: {fmtDate(lead.discoveredAt)} · Son doğrulama: {fmtDate(lead.lastVerifiedAt)}
              {lead.nextRefreshAt && <> · Yenileme: {fmtDate(lead.nextRefreshAt)}</>}
            </CardBody>
          </Card>

          {canWrite && (
            <form action={deleteLeadAction}>
              <input type="hidden" name="id" value={lead.id} />
              <Button type="submit" variant="danger" size="sm">
                <Trash2 className="size-4" aria-hidden /> Lead&apos;i sil
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
