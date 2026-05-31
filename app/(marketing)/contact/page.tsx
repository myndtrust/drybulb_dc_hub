import { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "Contact",
  description: "Get in touch with Drybulb — questions, feedback, or topic suggestions.",
  canonicalPath: "/contact",
});

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">Contact</p>
      <h1 className="text-4xl font-bold tracking-tight mb-8">Get in touch</h1>
      <div className="space-y-4 text-muted-foreground">
        <p>
          Questions, feedback, or suggestions for topics you&apos;d like to see covered? Drop us a line.
        </p>
        <p>Email: <a href="mailto:hello@drybulb.com" className="text-foreground underline underline-offset-4">hello@drybulb.com</a> {/* TODO: update email */}</p>
      </div>
    </div>
  );
}
