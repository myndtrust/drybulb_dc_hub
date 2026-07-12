import { PremiumGate } from "@/components/app/premium-gate";
import { SingleLineEditor } from "@/components/factory/single-line-editor";

export const metadata = {
  title: "AI Factory Single-line — Drybulb",
  description:
    "Design the data-center electrical single-line (sources → 4-to-make-3 UPS → switchboards → RPP → racks) and roll it up into the cost model.",
};

export default function SingleLinePage() {
  return (
    <PremiumGate slug="single-line" toolTitle="AI Factory Single-line">
      <SingleLineEditor />
    </PremiumGate>
  );
}
