import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { requireTenantPage } from "@/server/tenancy/context";
import { can } from "@/server/tenancy/permissions";
import { getInquiryMailbox, getInquiryReport, getLastInquiryAnalysis, type InquiryRunResult } from "@/server/services/inquiry-insights";
import { deleteInquiryMailboxAction, setInquiryStatusAction, startInquiryAnalysisAction } from "@/app/actions/inquiries";
import { JobPoller } from "@/components/job-poller";
import { ActionButton } from "@/components/action-button";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { InquiryMailboxForm, StartAnalysisButton } from "./inquiry-forms";

export const metadata: Metadata = { title: "Teklif talepleri" };

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(d) : "—");

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-sm">
      <span className="truncate text-text-2" title={label}>{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </span>
      <span className="text-right font-medium tabular-nums text-text">{value}</span>
    </li>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: Array<{ name: string; count: number }>; empty: string }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-text-3">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.slice(0, 12).map((r) => <Bar key={r.name} label={r.name} value={r.count} max={max} />)}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default async function InquiriesPage() {
  const ctx = await requireTenantPage();
  const canManage = can(ctx, "email.settings");
  const canReview = can(ctx, "campaign.write");
  const [mailbox, report, lastJob] = await Promise.all([canManage ? getInquiryMailbox(ctx) : Promise.resolve(null), getInquiryReport(ctx), getLastInquiryAnalysis(ctx)]);
  const running = lastJob && (lastJob.status === "QUEUED" || lastJob.status === "RUNNING");
  const last = lastJob?.status === "SUCCEEDED" ? (lastJob.result as InquiryRunResult | null) : null;

  return (
    <>
      <PageHeader
        title="Teklif talepleri"
        description="Firmanızın teklif kutusuna kimlerin, hangi sektörden ve hangi yay için yazdığı. Yalnızca kampanya hedeflemesi için analiz edilir."
      />

      <div className="flex flex-col gap-6">
        {canManage && (
          <Card>
            <CardHeader
              title="Teklif kutusu bağlantısı"
              description="Kutu salt okunur açılır: okundu işareti konmaz, hiçbir şey silinmez ve bu kutudan e-posta gönderilmez. AI'ya giden metinde e-posta adresleri ve telefonlar maskelenir; ileti metinleri saklanmaz."
            />
            <CardBody className="flex flex-col gap-4">
              {mailbox?.lastError && <Alert tone="warning">Son bağlantı başarısız: {mailbox.lastError}</Alert>}
              <InquiryMailboxForm values={mailbox ?? {}} hasPassword={Boolean(mailbox)} />
              {mailbox && (
                <form action={deleteInquiryMailboxAction}>
                  <Button type="submit" variant="ghost" size="sm">Bağlantıyı kaldır</Button>
                </form>
              )}
            </CardBody>
          </Card>
        )}

        {canManage && mailbox && (
          <Card>
            <CardHeader
              title="Analiz"
              description="Son 24 ayın iletileri okunur. Daha önce analiz edilen iletiler atlanır; yalnızca yeni gelenler için kredi harcanır (8 ileti başına 1 kredi)."
            />
            <CardBody className="flex flex-col gap-3">
              {running ? (
                <JobPoller jobId={lastJob.id} label="Teklif kutusu analiz ediliyor…" />
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <StartAnalysisButton />
                  {report.total > 0 && (
                    <ActionButton
                      action={startInquiryAnalysisAction}
                      fields={{ full: "1" }}
                      variant="secondary"
                      size="md"
                      pendingText="Başlatılıyor…"
                      confirm={`Daha önce analiz edilen ${report.total} ileti dahil hepsi yeniden analiz edilecek (yaklaşık ${Math.ceil(report.total / 8)} kredi). "Rapordan çıkar" işaretleri korunur. Devam edilsin mi?`}
                    >
                      Tümünü yeniden analiz et
                    </ActionButton>
                  )}
                </div>
              )}
              {lastJob?.status === "FAILED" && <Alert tone="warning">Son analiz tamamlanamadı: {lastJob.error}</Alert>}
              {last && (
                <p className="text-sm text-text-2">
                  Son analiz ({fmt(lastJob!.finishedAt)}): {last.read} ileti okundu, {last.alreadyProcessed} önceden işlenmişti, {last.skipped} ileti (kendi
                  gönderimleriniz, otomatik yanıtlar, bültenler) atlandı, {last.analyzed} ileti analiz edildi ve {last.inquiries} teklif talebi bulundu
                  {last.reclassified ? ` (${last.reclassified} eski talep yeniden sınıflandırıldı)` : ""}.
                  {last.stoppedForCredits && " Kredi yetersiz olduğu için yarıda kaldı; kredi yükleyip tekrar başlatın, kaldığı yerden devam eder."}
                </p>
              )}
            </CardBody>
          </Card>
        )}

        {report.inquiries === 0 && report.rejected === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox className="size-8" />}
              title="Henüz teklif talebi yok"
              description={canManage ? "Teklif kutusunu bağlayıp analizi başlatın." : "Yönetici teklif kutusunu bağlayıp analizi başlattığında burada görünür."}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat label="Analiz edilen ileti" value={report.total} />
                <Stat label="Teklif talebi" value={report.inquiries} />
                <Stat label="Seri üretim" value={report.serial} />
                <Stat label="Bakım-onarım" value={report.maintenance} />
                <Stat label="Rapordan çıkarılan" value={report.rejected} />
              </CardBody>
            </Card>

            <Alert tone="neutral">
              Bu sayılar AI&apos;ın iletilerden çıkardığı bilgilerdir. Yanlış görünen talebi aşağıdaki listeden &quot;Rapordan çıkar&quot; ile çıkarabilirsiniz.
            </Alert>

            {report.byCategory.some((c) => c.name === "Sınıflandırılmamış") && (
              <Alert tone="warning">
                Bazı talepler sektör kategorisi eklenmeden önce analiz edildi. &quot;Teklif taleplerini analiz et&quot;e bir kez daha basın; yalnızca bu talepler
                yeniden sınıflandırılır.
              </Alert>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Breakdown title="Sektöre göre" rows={report.byCategory} empty="Sektör bilgisi çıkarılamadı." />
              <Breakdown title="Kullanım amacına göre" rows={report.byPurpose} empty="Kullanım amacı belirtilmemiş." />
              <Breakdown title="Yay tipine göre" rows={report.bySpringType} empty="Yay tipi belirtilmemiş." />
              <Breakdown title="Şehir / ülkeye göre" rows={report.byCity} empty="Konum belirtilmemiş." />
            </div>

            <Card>
              <CardHeader title={`Talepler (${report.items.length})`} />
              <ul className="divide-y divide-border">
                {report.items.map((q) => (
                  <li key={q.id} className={q.status === "REJECTED" ? "px-5 py-4 opacity-50" : "px-5 py-4"}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{q.companyName ?? q.senderDomain ?? "Firma adı yok"}</span>
                      {q.category && <Badge tone="accent">{q.category}</Badge>}
                      {q.purpose && q.purpose !== "belirsiz" && <Badge tone="success">{q.purpose}</Badge>}
                      {q.springTypes.map((t) => <Badge key={t}>{t}</Badge>)}
                      {q.status === "REJECTED" && <Badge tone="warning">Rapordan çıkarıldı</Badge>}
                      <span className="ml-auto text-xs text-text-3">{fmt(q.receivedAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-text-2">
                      {[q.sector, q.application, q.quantity, q.city ?? q.country].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {q.evidence && <p className="mt-1 text-xs italic text-text-3">&ldquo;{q.evidence}&rdquo;</p>}
                    {canReview && (
                      <div className="mt-2">
                        <ActionButton
                          action={setInquiryStatusAction}
                          fields={{ id: q.id, status: q.status === "REJECTED" ? "PENDING" : "REJECTED" }}
                          variant="ghost"
                        >
                          {q.status === "REJECTED" ? "Rapora geri al" : "Rapordan çıkar"}
                        </ActionButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
