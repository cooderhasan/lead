import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Signals" };

export default function Page() {
  return (
    <ComingSoon
      title="Signals"
      phase={2}
      description="Satın alma sinyalleri: yeni tesis, kapasite artışı, işe alım…"
      bullets={["Kesin niyet değil, satış sinyali olarak gösterim", "Kaynak bağlantısı ile", "Lead puanına etkisi", "Rakip sinyalleri (Faz 5)"]}
    />
  );
}
