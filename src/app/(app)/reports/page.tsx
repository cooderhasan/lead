import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <ComingSoon
      title="Reports"
      phase={4}
      description="Haftalık satış raporu ve AI satış koçu."
      bullets={["Haftalık rapor", "En iyi / en kötü mesaj", "Kaybedilen fırsat analizi", "Gelir hedefi tahmini (tahmin olarak)"]}
    />
  );
}
