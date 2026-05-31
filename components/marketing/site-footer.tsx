import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 py-10 mt-16">
      <div className="container mx-auto max-w-5xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>&copy; {year} Drybulb. All rights reserved.</p>
        <nav className="flex items-center gap-4">
          <Link href="/writing" className="hover:text-foreground transition-colors">Blog</Link>
          <Link href="/tools" className="hover:text-foreground transition-colors">Tools</Link>
          <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
