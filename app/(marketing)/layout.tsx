import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { JsonLd } from "@/components/shared/json-ld";
import { siteGraph } from "@/lib/structured-data";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <JsonLd data={siteGraph()} />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
