import { notFound } from "next/navigation";

// Every path that no page matches lands here, and gets the 404 from
// ../not-found.tsx inside the site's own layout. Without this route Next.js
// answers with its built-in 404, which is prerendered at build time: its scripts
// carry no nonce, so the Content-Security-Policy that proxy.ts puts on every
// response would block them (see lib/csp.ts). Rendered here, on request like
// every other page, the 404 gets this request's nonce.
export default function UnknownPage() {
  notFound();
}
