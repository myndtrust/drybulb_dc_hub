import { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "Contact",
  description: "Get in touch with Drybulb for consulting inquiries.",
  canonicalPath: "/contact",
});

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">Contact</p>
      <h1 className="text-4xl font-bold tracking-tight mb-8">Get in touch</h1>
      <div className="space-y-4 text-muted-foreground">
        <p>Email: <a href="mailto:support@drybulb.com" className="text-foreground underline underline-offset-4">support@drybulb.com</a> {/* TODO */}</p>
        {/* <p>LinkedIn: <a href="#" className="text-foreground underline underline-offset-4">linkedin.com/in/PLACEHOLDER</a> TODO</p> */}
      </div>
    </div>
  );
}
