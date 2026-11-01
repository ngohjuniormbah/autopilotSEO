import type { Metadata } from "next";
import { termsMarkup } from "../_terms-markup";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return <div className="min-h-screen bg-white text-[#111827]"><div className="legal-page" dangerouslySetInnerHTML={{ __html: termsMarkup }} /></div>;
}
