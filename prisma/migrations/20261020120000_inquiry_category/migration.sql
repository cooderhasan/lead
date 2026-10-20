-- Teklif talebi: sabit sektör kategorisi + kullanım amacı (seri üretim / bakım-onarım / prototip)
ALTER TABLE "InboundInquiry" ADD COLUMN "category" TEXT;
ALTER TABLE "InboundInquiry" ADD COLUMN "purpose" TEXT;
