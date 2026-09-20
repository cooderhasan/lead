import type { Metadata } from "next";
import { Swords } from "lucide-react";
import { requireTenantPage } from "@/server/tenancy/context";
import { tenantDb } from "@/server/tenancy/tenant-db";
import { deleteCompetitorAction } from "@/app/actions/onboarding";
import { CompetitorForm, DeleteIcon } from "@/app/onboarding/steps";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Rakipler" };

export default async function CompetitorsPage() {
  const ctx = await requireTenantPage();
  const competitors = await tenantDb(ctx).competitor.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <>
      <PageHeader
        title="Competitors"
        description="Rakiplerinizi tanımlayın. Kamuya açık sinyallerin otomatik izlenmesi Faz 5'te eklenecek."
        actions={<Badge tone="accent">İzleme: Faz 5</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          {competitors.length === 0 ? (
            <EmptyState icon={<Swords className="size-8" />} title="Henüz rakip eklenmedi" />
          ) : (
            <ul className="divide-y divide-border">
              {competitors.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text">{c.name}</p>
                    {c.website && <p className="truncate text-xs text-text-3">{c.website}</p>}
                    {(c.strengths.length > 0 || c.weaknesses.length > 0) && (
                      <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                        {c.strengths.length > 0 && <p><span className="text-success">Güçlü:</span> <span className="text-text-2">{c.strengths.join(", ")}</span></p>}
                        {c.weaknesses.length > 0 && <p><span className="text-danger">Zayıf:</span> <span className="text-text-2">{c.weaknesses.join(", ")}</span></p>}
                      </div>
                    )}
                  </div>
                  <form action={deleteCompetitorAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" size="sm" variant="ghost" aria-label={`${c.name} sil`}><DeleteIcon /></Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Rakip ekle" />
          <CardBody className="py-5"><CompetitorForm /></CardBody>
        </Card>
      </div>
    </>
  );
}
