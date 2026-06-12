import Link from "next/link";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "/writing", label: "Blog" },
  { href: "/tools", label: "Tools" },
  { href: "/jobs", label: "Jobs" },
  { href: "/consulting", label: "Advisory Services" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight hover:text-foreground/80 transition-colors"
        >
          Drybulb
        </Link>
        <nav className="flex items-center gap-6">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {label}
            </Link>
          ))}
          <Button asChild size="sm">
            <Link href="/contact">Contact</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
