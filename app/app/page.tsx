import type { Metadata } from "next";
import AccountHome from "@/components/account-home";
export const metadata: Metadata = { title: "Workspace", robots: { index: false, follow: false } };
export default function WorkspacePage(){return <AccountHome/>;}
