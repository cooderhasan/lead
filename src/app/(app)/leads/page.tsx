import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Globe, Mail, Phone, Plus, Send, Star, Target } from "lucide-react";
import type { LeadStatus } from "@prisma/client";
import { requireTenantPage } from "@/server/tenancy/context";
import { can } from "@/server/tenancy/permissions";
import { env } from "@/server/env";
import { isLeadSourceConfigured, LEAD_SOURCE_LABELS } from "@/server/providers/lead-source";
import { isAIConfigured } from "@/server/ai";
import { LEAD_STATUS_LABELS, leadStats, listLeads } from "@/server/services/leads";
import { getLastEmailDiscovery, getLastListImport, listRecentSearches } from "@/server/services/lead-intelligence";
import { JobPoller } from "@/components/job-poller";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Input, LinkButton, PageHeader, Select, StatCard, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LEAD_STATUSES } from "@/lib/validation";
import { scoreTone } from "@/lib/lead-scoring";
import { CsvImportForm, FindEmailsButton, LeadSearchForm, ListImportForm, QuickDeleteButton, QuickEmailForm, ScoreLeadsButton } from "./lead-forms";

export const metadata: Metadata = { title: "Potansiyel müşteriler" };

const PAGE_SIZE = 50;

const SOURCE_LABELS: Record<string, string> = {
  apify: "Google Haritalar",
  "apify-web": "Web araması",
  directory: "Liste sayfası",
  csv: "CSV",
  manual: "Elle",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; min?: string; page?: string }>;
}) {
  const ctx = await requireTenantPage();
  const sp = await searchParams;
  const status = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as LeadStatus) : undefined;
  const minScore = sp.min ? Math.max(0, Math.min(100, Number(sp.min) || 0)) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, stats, searches, emailRun, listRun] = await Promise.all([
    listLeads(ctx, { q: sp.q, status, minScore, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    leadStats(ctx),
    listRecentSearches(ctx, 5),
    getLastEmailDiscovery(ctx),
    getLastListImport(ctx),
  ]);
  const listRunning = listRun && (listRun.status === "QUEUED" || listRun.status === "RUNNING");
  const emailRunning = emailRun && (emailRun.status === "QUEUED" || emailRun.status === "RUNNING");
  const canWrite = can(ctx, "lead.write");
  const sourceReady = isLeadSourceConfigured();
  const aiReady = isAIConfigured();
  const running = searches.find((s) => s.status === "QUEUED" || s.status === "RUNNING");
  const unscored = rows.filter((r) => r.fitScore === null).map((r) => r.id);
  const missingEmail = rows.filter((r) => r.website && !r.genericEmail).map((r) => r.id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    if (status) u.set("status", status);
    if (minScore !== undefined) u.set("min", String(minScore));
    u.set("page", String(p));
    return `/leads?${u.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Potansiyel müşteriler"
        description="Potansiyel müşterileri bulun, araştırın ve puanlayın. Puanlar yalnızca doğrulanmış şirket bilgilerinize dayanır."
        actions={
          canWrite ? (
            <LinkButton href="/leads/new" variant="secondary">
              <Plus className="size-4" aria-hidden /> Elle ekle
            </LinkButton>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Toplam lead" value={stats.total} icon={<Building2 />} tone="accent" />
        <StatCard label="Puanlanan" value={stats.scored} icon={<Target />} />
        <StatCard label="Yüksek uyum (70+)" value={stats.qualified} icon={<Star />} tone="success" />
        <StatCard label="İletişime hazır" value={stats.contactReady} icon={<Send />} tone="warning" />
      </div>

      {canWrite && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardHeader title="AI ile lead bul" description="Doğal dille yazın; AI aramayı işletme dizinlerinde uygulanabilir sorguya çevirir." />
            <CardBody className="flex flex-col gap-4">
              {!sourceReady && (
                <Alert tone="warning">
                  Otomatik arama kapalı: sunucuda <code>APIFY_TOKEN</code> tanımlı değil. CSV ile içe aktarabilir veya elle ekleyebilirsiniz.
                </Alert>
              )}
              {sourceReady && !aiReady && (
                <Alert tone="neutral">AI kapalı — arama ifadeniz olduğu gibi kullanılır, puanlama yapılamaz.</Alert>
              )}
              {running ? (
                <JobPoller
                  jobId={running.id}
                  label={`Aranıyor: ${running.interpretation || running.prompt}`}
                  steps={[[0, "Arama başlatılıyor…"], [10, "Kaynak taranıyor (birkaç dakika sürebilir)…"], [80, "Tekrarlar ayıklanıyor ve kaydediliyor…"]]}
                />
              ) : (
                <LeadSearchForm enabled={sourceReady} maxLimit={env().LEAD_SEARCH_MAX} />
              )}
              {searches.filter((s) => s !== running).length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                  {searches
                    .filter((s) => s !== running)
                    .map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-text-2" title={s.interpretation}>{s.prompt}</span>
                        <span className="shrink-0 text-text-3">{LEAD_SOURCE_LABELS[s.source]}</span>
                        {s.status === "SUCCEEDED" ? (
                          <Badge tone="success">{s.created ?? 0} yeni · {s.merged ?? 0} birleşti</Badge>
                        ) : s.status === "FAILED" ? (
                          <Badge tone="danger" title={s.error ?? undefined}>Başarısız · kredi iade</Badge>
                        ) : (
                          <Badge>{s.status}</Badge>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Listeden içe aktar" description="Hazır firma listelerini ekleyin; tekrar eden firmalar otomatik birleştirilir." />
            <CardBody className="flex flex-col gap-4">
              {listRunning ? (
                <JobPoller
                  jobId={listRun.id}
                  label="Liste okunuyor ve firmalar çıkarılıyor…"
                  steps={[[0, "Sayfa okunuyor…"], [20, "AI firmaları çıkarıyor (1-2 dakika)…"], [80, "Doğrulanıp kaydediliyor…"]]}
                />
              ) : (
                <>
                  {listRun && <ListImportSummary run={listRun} />}
                  <ListImportForm enabled={aiReady} />
                </>
              )}
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm font-medium text-text">CSV dosyası</p>
                <CsvImportForm />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-4" action="/leads">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Firma, alan adı, şehir, sektör…" className="min-w-48 flex-1" aria-label="Ara" />
          <Select name="status" defaultValue={status ?? ""} className="w-44" aria-label="Durum">
            <option value="">Tüm durumlar</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
            ))}
          </Select>
          <Select name="min" defaultValue={minScore !== undefined ? String(minScore) : ""} className="w-36" aria-label="En az puan">
            <option value="">Tüm puanlar</option>
            <option value="70">70+</option>
            <option value="45">45+</option>
          </Select>
          <button type="submit" className={buttonClass("secondary")}>Filtrele</button>
        </form>
        {/* Filtre formunun DIŞINDA olmalı: iç içe <form> geçersizdir, tarayıcı butonu dış formu (filtre) gönderir */}
        {emailRun && (
          <div className="border-b border-border px-5 py-3">
            {emailRunning ? (
              <JobPoller
                jobId={emailRun.id}
                label={`${emailRun.total} firmanın web sitesinde kurumsal e-posta aranıyor…`}
                steps={[[0, "Siteler sırayla taranıyor (firma başına birkaç saniye)…"]]}
              />
            ) : (
              <EmailDiscoverySummary run={emailRun} canWrite={canWrite} />
            )}
          </div>
        )}
        {canWrite && ((aiReady && unscored.length > 0) || (missingEmail.length > 0 && !emailRunning)) && (
          <div className="flex flex-wrap justify-end gap-3 border-b border-border px-5 py-3">
            {missingEmail.length > 0 && !emailRunning && <FindEmailsButton leadIds={missingEmail} />}
            {aiReady && unscored.length > 0 && (
              <ScoreLeadsButton leadIds={unscored} label={`Bu sayfadaki ${unscored.length} lead'i puanla (${unscored.length} kredi)`} />
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-8" />}
            title={total === 0 && !sp.q && !status ? "Henüz lead yok" : "Filtreye uyan lead yok"}
            description="AI ile arama yapın, CSV yükleyin veya elle ekleyin."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-surface-2/50 text-left text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-5 py-2.5">Firma</th>
                  <th className="px-3 py-2.5 text-center">Puan</th>
                  <th className="px-3 py-2.5">Konum</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Sektör</th>
                  <th className="px-3 py-2.5">Durum</th>
                  <th className="hidden px-5 py-2.5 xl:table-cell">Kaynak</th>
                  {canWrite && <th className="w-12 px-3 py-2.5"><span className="sr-only">İşlemler</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((l) => (
                  <tr key={l.id} className="group transition-colors hover:bg-surface-2/60">
                    <td className="max-w-80 px-5 py-3">
                      <Link href={`/leads/${l.id}`} className="line-clamp-2 font-medium text-text group-hover:text-accent-text">{l.companyName}</Link>
                      <div className="mt-1 flex items-center gap-2.5 text-text-3">
                        <ContactIcon on={Boolean(l.phone)} label={l.phone ?? "Telefon yok"}><Phone /></ContactIcon>
                        <ContactIcon on={Boolean(l.genericEmail)} label={l.genericEmail ?? "E-posta yok"}><Mail /></ContactIcon>
                        <ContactIcon on={Boolean(l.website)} label={l.domain ?? "Web sitesi yok"}><Globe /></ContactIcon>
                        {l.domain && <span className="truncate text-xs">{l.domain}</span>}
                      </div>
                      {canWrite && !l.genericEmail && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs font-medium text-accent-text">+ e-posta ekle</summary>
                          <div className="mt-2">
                            <QuickEmailForm leadId={l.id} />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {l.fitScore === null ? <span className="text-xs text-text-3">—</span> : <ScorePill score={l.fitScore} />}
                    </td>
                    <td className="px-3 py-3 text-text-2">{[l.district, l.city].filter(Boolean).join(", ") || "—"}</td>
                    <td className="hidden max-w-52 truncate px-3 py-3 text-text-2 lg:table-cell">{l.industry ?? "—"}</td>
                    <td className="px-3 py-3"><Badge>{LEAD_STATUS_LABELS[l.status]}</Badge></td>
                    <td className="hidden px-5 py-3 xl:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(l.sources.map((s) => s.provider))].map((p) => (
                          <span key={p} className="text-xs text-text-3">{SOURCE_LABELS[p] ?? p}</span>
                        ))}
                      </div>
                    </td>
                    {canWrite && (
                      <td className="px-3 py-3">
                        <div className="opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <QuickDeleteButton leadId={l.id} name={l.companyName} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-text-2">
            <span>{total} lead · sayfa {page}/{pages}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton href={qs(page - 1)} variant="secondary" size="sm">Önceki</LinkButton>}
              {page < pages && <LinkButton href={qs(page + 1)} variant="secondary" size="sm">Sonraki</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function ContactIcon({ on, label, children }: { on: boolean; label: string; children: React.ReactNode }) {
  return (
    <span title={label} aria-label={label} className={cn("[&>svg]:size-3.5", on ? "text-success" : "text-text-3/50")}>
      {children}
    </span>
  );
}

/** Puan: renkli halka + sayı (70+ yeşil, 45+ turuncu, altı kırmızı) */
function ScorePill({ score }: { score: number }) {
  const tone = scoreTone(score);
  const color = tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : "var(--danger)";
  return (
    <span
      className="inline-grid size-9 place-items-center rounded-full text-xs font-semibold tabular-nums text-text"
      style={{ background: `conic-gradient(${color} ${score * 3.6}deg, var(--surface-3) 0deg)` }}
      title={`Uygunluk puanı: ${score}/100`}
    >
      <span className="grid size-7 place-items-center rounded-full bg-surface">{score}</span>
    </span>
  );
}

function EmailDiscoverySummary({ run, canWrite }: { run: NonNullable<Awaited<ReturnType<typeof getLastEmailDiscovery>>>; canWrite: boolean }) {
  const when = run.finishedAt?.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (run.status !== "SUCCEEDED") {
    return <Alert tone="danger">E-posta araması tamamlanamadı{run.error ? `: ${run.error}` : "."} Tekrar deneyebilirsiniz.</Alert>;
  }
  const missing = run.notFound + run.blocked + run.failed;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">
            Son e-posta araması{when ? <span className="font-normal text-text-3"> · {when}</span> : null}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Badge tone="success">{run.found} firmada bulundu</Badge>
            {run.notFound > 0 && <Badge>{run.notFound} sitede kurumsal adres yok</Badge>}
            {run.blocked > 0 && <Badge title="Site robots.txt ile otomatik taramayı yasaklıyor; buna uyuyoruz">{run.blocked} site taramaya izin vermiyor</Badge>}
            {run.failed > 0 && <Badge tone="warning" title="Alan adı yok, site kapalı veya bağlantıyı reddediyor">{run.failed} site açılmıyor</Badge>}
            <span className="text-xs text-text-3 self-center">toplam {run.total} firma</span>
          </div>
          {run.blocked > 0 && (
            <p className="mt-2 text-xs text-text-3">
              Taramaya izin vermeyen sitelerdeki adresi kendiniz görüp firmanın sayfasında &quot;İletişim bilgilerini düzenle&quot; ile girebilirsiniz.
            </p>
          )}
        </div>
        {missing > 0 && (
          <LinkButton href="/calls?view=all&noEmail=1" variant="secondary" size="sm">
            <Phone className="size-4" aria-hidden /> Bulunamayanları telefonla ara
          </LinkButton>
        )}
      </div>
      {run.items.length > 0 && (
        <details className="group rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-accent-text">Firma firma sonuçları göster ({run.items.length})</summary>
          <ul className="divide-y divide-border border-t border-border">
            {[...run.items]
              .sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome))
              .map((it) => (
                <li key={it.leadId} className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                  <span className="shrink-0 lg:w-36"><Badge tone={OUTCOME_META[it.outcome].tone}>{OUTCOME_META[it.outcome].label}</Badge></span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${it.leadId}`} className="block truncate text-sm font-medium text-text hover:text-accent-text">{it.name}</Link>
                    <p className="text-xs text-text-2">
                      {it.currentEmail ? <span className="font-medium text-success">{it.currentEmail}</span> : it.reason}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-start gap-1.5">
                      {!it.currentEmail && <QuickEmailForm leadId={it.leadId} />}
                      <QuickDeleteButton leadId={it.leadId} name={it.name} />
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const OUTCOME_ORDER = ["found", "blocked", "notFound", "failed"] as const;
const OUTCOME_META: Record<(typeof OUTCOME_ORDER)[number], { label: string; tone: "success" | "neutral" | "warning" }> = {
  found: { label: "Bulundu", tone: "success" },
  blocked: { label: "Taramaya izin yok", tone: "neutral" },
  notFound: { label: "Kurumsal adres yok", tone: "neutral" },
  failed: { label: "Site açılmıyor", tone: "warning" },
};

function ListImportSummary({ run }: { run: NonNullable<Awaited<ReturnType<typeof getLastListImport>>> }) {
  if (run.status !== "SUCCEEDED") {
    return <Alert tone="danger">Son liste içe aktarılamadı{run.error ? `: ${run.error}` : "."} Kredi iade edildi.</Alert>;
  }
  const added = (run.created ?? 0) + (run.merged ?? 0);
  return (
    <Alert tone={added > 0 ? "success" : "neutral"}>
      <p className="font-medium">
        Son liste: {run.created ?? 0} yeni firma eklendi{run.merged ? `, ${run.merged} mevcut kayıtla birleşti` : ""}.
      </p>
      <p className="mt-0.5 text-xs opacity-80">
        {run.extracted ?? 0} firma okundu
        {run.dropped ? ` · ${run.dropped} tanesi kaynakta doğrulanamadığı için alınmadı` : ""}
        {run.truncated ? " · liste uzundu, ilk kısmı işlendi (kalanı için sonraki sayfanın adresini girin)" : ""}
        {added === 0 ? " · firma çıkmadığı için kredi iade edildi" : ""}
      </p>
    </Alert>
  );
}
