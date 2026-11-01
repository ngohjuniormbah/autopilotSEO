import type { Metadata } from "next";
import AuthScreen from "@/components/auth-screen";
export const metadata: Metadata = { title: "Verify email", robots: { index: false, follow: false } };
export default function VerifyEmailPage(){ return <AuthScreen mode="verify"/>; }
