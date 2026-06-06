import { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";
import { ContactForm } from "@/components/marketing/contact-form";
import { ENGAGEMENT_OPTIONS } from "@/lib/engagements";

export const metadata: Metadata = constructMetadata({
  title: "Contact",
  description:
    "Get in touch with Drybulb — consulting inquiries, questions, feedback, or topic suggestions.",
  canonicalPath: "/contact",
});

type Props = {
  searchParams: Promise<{ engagement?: string }>;
};

export default async function ContactPage({ searchParams }: Props) {
  const { engagement } = await searchParams;
  const defaultEngagement = ENGAGEMENT_OPTIONS.some((o) => o.value === engagement)
    ? (engagement as string)
    : "general";

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Contact
      </p>
      <h1 className="text-4xl font-bold tracking-tight mb-8">Get in touch</h1>
      <div className="space-y-4 text-muted-foreground mb-10">
        <p>
          Consulting inquiries, questions, feedback, or a topic you&apos;d like to see
          covered — use the form below and it comes straight to me. Prefer email? Reach me
          at{" "}
          <a
            href="mailto:hello@drybulb.com"
            className="text-foreground underline underline-offset-4"
          >
            hello@drybulb.com
          </a>
          .
        </p>
      </div>
      <ContactForm defaultEngagement={defaultEngagement} />
    </div>
  );
}
