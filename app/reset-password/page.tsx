import type { Metadata } from "next";
import AuthScreen from "@/components/auth-screen";
export const metadata: Metadata = { title: "Password reset", robots: { index: false, follow: false } };
export default function ResetPasswordPage(){ return <AuthScreen mode="reset"/>; }
