import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import type { MessageStatus } from "@prisma/client";
import { requireTenantPage } from "@/server/tenancy/context";
import { can } from "@/server/tenancy/permissions";
import { listCampaignMessages, MESSAGE_STATUS_LABELS } from "@/server/services/campaigns";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MessageCard } from "../campaigns/campaign-forms";
import { toMessageCard } from "../campaigns/message-data";

export const metadata: Metadata = { title: "Mesajlar" };

const FILTERS: Array<{ key: string; label: string; status?: MessageStatus }> = [
  { key: "pending", label: "Onay bekleyen", status: "PENDING_APPROVAL" },
  { key: "approved", label: "Onaylı", status: "APPROVED" },
  { key: "sent", label: "Gönderilen", status: "SENT" },
  { key: "bounced", label: "Geri dönen", status: "BOUNCED" },
  { key: "failed", label: "Başarısız", status: "FAILED" },
  { key: "all", label: "Tümü" },
];

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const ctx = await requireTenantPage();
  const { f } = await searchParams;
  const active = FILTERS.find((x) => x.key === f) ?? FILTERS[0]!;
  const messages = await listCampaignMessages(ctx, { status: active.status, take: 200 });
  const canEdit = can(ctx, "message.approve");

  return (
    <>
      <PageHeader title="Mesajlar" description="Tüm kampanyalardaki giden iletiler. AI yazar, siz onaylarsınız." />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Durum filtresi">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/messages?f=${x.key}`}
            aria-current={x.key === active.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              x.key === active.key ? "border-accent bg-accent-soft text-accent-text" : "border-border text-text-2 hover:text-text",
            )}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      <Card>
        {messages.length === 0 ? (
          <EmptyState
            icon={<Mail className="size-8" />}
            title={`${active.status ? MESSAGE_STATUS_LABELS[active.status] : "Hiç"} mesaj yok`}
            description="Mesajlar kampanya ekranında, strateji onaylandıktan sonra üretilir."
          />
        ) : (
          <CardBody className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id}>
                {m.campaign && (
                  <Link href={`/campaigns/${m.campaign.id}`} className="mb-1 inline-block text-xs text-text-3 hover:text-accent">
                    {m.campaign.name}
                  </Link>
                )}
                <MessageCard m={toMessageCard(m, m.lead.companyName, canEdit)} />
              </div>
            ))}
          </CardBody>
        )}
      </Card>
    </>
  );
}
