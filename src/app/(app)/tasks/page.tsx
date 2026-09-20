import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Tasks" };

export default function Page() {
  return (
    <ComingSoon
      title="Tasks"
      phase={4}
      description="AI'ın ve ekibin oluşturduğu satış görevleri."
      bullets={["\"ABC Otomotiv'i ara\" gibi görevler", "Bugün ne yapmalıyım? önceliklendirmesi", "Follow-up hatırlatmaları", "Sıcak lead bildirimleri"]}
    />
  );
}
