import type { Metadata } from "next";
import AuthScreen from "@/components/auth-screen";
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };
export default function NewPasswordPage(){ return <AuthScreen mode="new-password"/>; }
