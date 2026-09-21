import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import type { LeadStatus } from "@prisma/client";
import { requireTenantPage } from "@/server/tenancy/context";
import { can } from "@/server/tenancy/permissions";
import { env } from "@/server/env";
import { isLeadSourceConfigured } from "@/server/providers/lead-source";
import { isAIConfigured } from "@/server/ai";
import { LEAD_STATUS_LABELS, leadStats, listLeads } from "@/server/services/leads";
import { listRecentSearches } from "@/server/services/lead-intelligence";
import { JobPoller } from "@/components/job-poller";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Input, LinkButton, PageHeader, Select, Stat, buttonClass } from "@/components/ui";
import { LEAD_STATUSES } from "@/lib/validation";
import { scoreTone } from "@/lib/lead-scoring";
import { CsvImportForm, LeadSearchForm, ScoreLeadsButton } from "./lead-forms";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 50;

const SOURCE_LABELS: Record<string, string> = {
  apify: "Google Haritalar",
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

  const [{ rows, total }, stats, searches] = await Promise.all([
    listLeads(ctx, { q: sp.q, status, minScore, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    leadStats(ctx),
    listRecentSearches(ctx, 5),
  ]);
  const canWrite = can(ctx, "lead.write");
  const sourceReady = isLeadSourceConfigured();
  const aiReady = isAIConfigured();
  const running = searches.find((s) => s.status === "QUEUED" || s.status === "RUNNING");
  const unscored = rows.filter((r) => r.fitScore === null).map((r) => r.id);
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
        title="Leads"
        description="Potansiyel müşterileri bulun, araştırın ve puanlayın. Puanlar yalnızca doğrulanmış şirket bilgilerinize dayanır."
        actions={
          canWrite ? (
            <LinkButton href="/leads/new" variant="secondary">
              <Plus className="size-4" aria-hidden /> Elle ekle
            </LinkButton>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><CardBody><Stat label="Toplam lead" value={stats.total} /></CardBody></Card>
        <Card><CardBody><Stat label="Puanlanan" value={stats.scored} /></CardBody></Card>
        <Card><CardBody><Stat label="Yüksek uyum (70+)" value={stats.qualified} /></CardBody></Card>
        <Card><CardBody><Stat label="İletişime hazır" value={stats.contactReady} /></CardBody></Card>
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
            <CardHeader title="CSV ile içe aktar" description="Elinizdeki firma listesini yükleyin; tekrar eden firmalar otomatik birleştirilir." />
            <CardBody>
              <CsvImportForm />
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
        {canWrite && aiReady && unscored.length > 0 && (
          <div className="flex justify-end border-b border-border px-5 py-3">
            <ScoreLeadsButton leadIds={unscored} label={`Bu sayfadaki ${unscored.length} lead'i puanla (${unscored.length} kredi)`} />
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
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs text-text-2">
                <tr>
                  <th className="px-5 py-3 font-medium">Firma</th>
                  <th className="px-3 py-3 font-medium">Konum</th>
                  <th className="px-3 py-3 font-medium">Sektör</th>
                  <th className="px-3 py-3 font-medium">Kaynak</th>
                  <th className="px-3 py-3 font-medium">Durum</th>
                  <th className="px-5 py-3 text-right font-medium">Puan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <Link href={`/leads/${l.id}`} className="font-medium text-text hover:text-accent">{l.companyName}</Link>
                      <p className="truncate text-xs text-text-3">{l.domain ?? l.phone ?? "İletişim bilgisi yok"}</p>
                    </td>
                    <td className="px-3 py-3 text-text-2">{[l.district, l.city].filter(Boolean).join(", ") || "—"}</td>
                    <td className="max-w-48 truncate px-3 py-3 text-text-2">{l.industry ?? "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(l.sources.map((s) => s.provider))].map((p) => (
                          <Badge key={p}>{SOURCE_LABELS[p] ?? p}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-text-2">{LEAD_STATUS_LABELS[l.status]}</td>
                    <td className="px-5 py-3 text-right">
                      {l.fitScore === null ? (
                        <span className="text-xs text-text-3">Puanlanmadı</span>
                      ) : (
                        <Badge tone={scoreTone(l.fitScore)}>{l.fitScore}</Badge>
                      )}
                    </td>
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
