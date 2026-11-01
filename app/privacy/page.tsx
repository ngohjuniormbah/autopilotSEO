import type { Metadata } from "next";
import { privacyMarkup } from "../_privacy-markup";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return <div className="min-h-screen bg-white text-[#111827]"><div className="legal-page" dangerouslySetInnerHTML={{ __html: privacyMarkup }} /></div>;
}
