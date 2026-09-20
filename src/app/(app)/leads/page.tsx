import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return (
    <ComingSoon
      title="Leads"
      phase={2}
      description="Potansiyel müşterileri bulun, araştırın ve puanlayın."
      bullets={["Doğal dil ile lead arama", "Google Maps / web kaynaklarından Apify ile toplama", "Duplicate temizleme", "0-100 puan ve görünür puan nedenleri", "Doğrulanmış bilgi / AI varsayımı ayrımı", "Kaynak şeffaflığı"]}
    />
  );
}
