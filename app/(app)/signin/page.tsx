import { SignInCard } from "@/components/app/sign-in";
import { safeNext } from "@/lib/safe-next";

export const metadata = {
  title: "Sign in — Drybulb",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <SignInCard next={safeNext(typeof next === "string" ? next : null, "/dashboard")} />;
}
