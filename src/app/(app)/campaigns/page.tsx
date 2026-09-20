import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Campaigns" };

export default function Page() {
  return (
    <ComingSoon
      title="Campaigns"
      phase={3}
      description="Yeni Satış Kampanyası: kime satmak istiyorsunuz?"
      bullets={["AI kampanya stratejisi ve onay", "Kişiselleştirilmiş mesaj taslakları", "Compliance: Gönderilebilir / İnceleme Gerekli / Gönderme", "Kampanya önizleme ve insan onayı"]}
    />
  );
}
