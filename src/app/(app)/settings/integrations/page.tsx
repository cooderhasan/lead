import type { Metadata } from "next";
import { requireTenantPage } from "@/server/tenancy/context";
import { env } from "@/server/env";
import { getEmbeddingProvider, isAIConfigured } from "@/server/ai";
import { Badge, Card, CardHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Entegrasyonlar" };

export default async function IntegrationsPage() {
  await requireTenantPage();
  const e = env();
  const embedding = getEmbeddingProvider();

  const rows: Array<{ name: string; detail: string; status: "ok" | "off" | "later"; note?: string }> = [
    { name: "AI sağlayıcı", detail: `${e.AI_PROVIDER}${e.AI_MODEL ? ` · ${e.AI_MODEL}` : ""}`, status: isAIConfigured() ? "ok" : "off", note: e.AI_FALLBACK_PROVIDER ? `Yedek: ${e.AI_FALLBACK_PROVIDER}` : undefined },
    { name: "Embedding (vektör arama)", detail: embedding ? `${embedding.name} · ${embedding.model}` : "Kapalı — tam metin araması kullanılıyor", status: embedding ? "ok" : "off" },
    { name: "Arka plan kuyruğu", detail: e.QUEUE_DRIVER === "bullmq" ? "BullMQ + Redis" : "Inline (geliştirme modu)", status: "ok" },
    { name: "Dosya depolama", detail: e.STORAGE_DRIVER === "s3" ? `S3 · ${e.S3_BUCKET}` : "Yerel disk", status: "ok" },
    { name: "Apify (lead kaynakları)", detail: e.APIFY_TOKEN ? "Token tanımlı" : "Token yok — CSV ve elle ekleme çalışır", status: e.APIFY_TOKEN ? "ok" : "off" },
    { name: "E-posta sağlayıcı", detail: e.EMAIL_PROVIDER ? `${e.EMAIL_PROVIDER} · günlük sınır ${e.EMAIL_DAILY_LIMIT}` : "Tanımlı değil — gönderim kapalı", status: e.EMAIL_PROVIDER ? "ok" : "off", note: "SMTP / Resend / Brevo" },
    { name: "E-posta webhook'ları", detail: e.EMAIL_WEBHOOK_SECRET ? "Geri dönme / şikâyet takibi açık" : "Kapalı (EMAIL_WEBHOOK_SECRET)", status: e.EMAIL_WEBHOOK_SECRET ? "ok" : "off" },
    { name: "WhatsApp Business API", detail: "Resmi API — şifre istenmez", status: "later", note: "Faz 5" },
    { name: "Ödeme", detail: "Stripe / iyzico / PayTR", status: "later", note: "Sonraki faz" },
  ];

  return (
    <Card>
      <CardHeader title="Entegrasyonlar" description="Sunucu yapılandırması (.env). API anahtarları bu ekranda gösterilmez." />
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.name}</p>
              <p className="truncate text-xs text-text-3">{r.detail}{r.note ? ` · ${r.note}` : ""}</p>
            </div>
            {r.status === "ok" ? <Badge tone="success">Aktif</Badge> : r.status === "off" ? <Badge tone="warning">Yapılandırılmadı</Badge> : <Badge>Planlandı</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
