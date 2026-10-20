-- Teklif kutusu analizi: AI ile çıkarılan talep özetleri (yalnızca hedefleme raporu; kişisel veri tutulmaz)
CREATE TABLE "InboundInquiry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "senderDomain" TEXT,
    "isInquiry" BOOLEAN NOT NULL,
    "companyName" TEXT,
    "sector" TEXT,
    "application" TEXT,
    "springTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" TEXT,
    "city" TEXT,
    "country" TEXT,
    "evidence" TEXT,
    "status" "FactStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundInquiry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundInquiry_companyId_sourceKey_key" ON "InboundInquiry"("companyId", "sourceKey");
CREATE INDEX "InboundInquiry_companyId_isInquiry_idx" ON "InboundInquiry"("companyId", "isInquiry");

ALTER TABLE "InboundInquiry" ADD CONSTRAINT "InboundInquiry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
