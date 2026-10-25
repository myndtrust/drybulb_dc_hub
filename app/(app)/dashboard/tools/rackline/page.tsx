import { PremiumGate } from "@/components/app/premium-gate";
import { RacklineApp } from "@/components/rackline/rackline-app";
import { TOOL_NAME } from "@/lib/rackline/constants";

export const metadata = {
  title: "AI Factory Infrastructure Management", // the site template appends " | Drybulb"
  description:
    "Lay out GPU racks over a scaled PDF or CAD background, stripe PDUs across A/B feeds, route cable pathways, size HAC / RDHx / DLC cooling and load the room single line — then compare scenarios side by side.",
};

export default function RacklinePage() {
  return (
    <PremiumGate slug="rackline" toolTitle={TOOL_NAME}>
      <RacklineApp />
    </PremiumGate>
  );
}
