import Script from "next/script";

// Privacy-friendly, cookieless analytics via Umami (cloud.umami.is).
// The website ID is not a secret — it ships in the client script — so it's
// hardcoded here. Only emitted in production so local dev traffic isn't counted.
const UMAMI_WEBSITE_ID = "cc19ab5e-8794-4ea7-a02b-bb4a430299a1";
const UMAMI_SRC = "https://cloud.umami.is/script.js";

export function Analytics() {
  if (process.env.NODE_ENV !== "production") return null;

  return (
    <Script
      defer
      data-website-id={UMAMI_WEBSITE_ID}
      src={UMAMI_SRC}
      strategy="afterInteractive"
    />
  );
}
