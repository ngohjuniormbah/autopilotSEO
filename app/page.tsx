import { homeMarkup } from "./_home-markup";
import SiteInteractions from "@/components/site-interactions";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-[#111827]">
      <div dangerouslySetInnerHTML={{ __html: homeMarkup }} />
      <SiteInteractions />
    </div>
  );
}
