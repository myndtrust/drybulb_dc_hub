import Link from "next/link";
import { NewsletterSignup } from "@/components/marketing/newsletter-signup";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 py-12 mt-16">
      <div className="container mx-auto max-w-5xl px-4">
        {/* Newsletter capture */}
        <div className="pb-10 mb-8 border-b border-border/60">
          <NewsletterSignup />
        </div>

        {/* Copyright + nav */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>&copy; {year} Drybulb. All rights reserved.</p>
          <nav className="flex items-center gap-4">
            <Link href="/writing" className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/tools" className="hover:text-foreground transition-colors">Tools</Link>
            <Link href="/jobs" className="hover:text-foreground transition-colors">Jobs</Link>
            <Link href="/consulting" className="hover:text-foreground transition-colors">Consulting</Link>
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
