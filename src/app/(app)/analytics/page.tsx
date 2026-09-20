import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <ComingSoon
      title="Analytics"
      phase={4}
      description="Satış hunisi ve kampanya performansı."
      bullets={["Kampanya bazlı dönüşüm", "A/B mesaj karşılaştırması", "Sektör / şehir performansı", "Yalnızca gerçek veriden içgörü"]}
    />
  );
}
