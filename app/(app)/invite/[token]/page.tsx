import { InviteFlow } from "@/components/rackline/invite-flow";

export const metadata = {
  title: "Project invite — Drybulb",
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteFlow token={token} />;
}
