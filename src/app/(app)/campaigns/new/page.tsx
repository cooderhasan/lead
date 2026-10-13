import type { Metadata } from "next";
import { requireTenantPage } from "@/server/tenancy/context";
import { assertCan } from "@/server/tenancy/permissions";
import { listProducts } from "@/server/services/products";
import { listLeadLists } from "@/server/services/leads";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { CampaignCreateForm } from "../campaign-forms";

export const metadata: Metadata = { title: "Yeni kampanya" };

export default async function NewCampaignPage() {
  const ctx = await requireTenantPage();
  assertCan(ctx, "campaign.write");
  const [allProducts, lists] = await Promise.all([listProducts(ctx, { status: "VERIFIED" }), listLeadLists(ctx)]);
  const products = allProducts.filter((p) => p.active);
  return (
    <>
      <PageHeader
        title="Yeni kampanya"
        description="Puan eşiğini geçen lead'ler (isteğe bağlı: yalnızca seçilen liste / şehir) kampanyaya alınır ve her adresin gönderim uygunluğu hemen kontrol edilir. Bu adım kredi harcamaz."
      />
      <Card className="max-w-2xl">
        <CardBody>
          <CampaignCreateForm
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            lists={lists.filter((l) => l.count > 0).map((l) => ({ id: l.id, name: l.name, count: l.count }))}
          />
        </CardBody>
      </Card>
    </>
  );
}
