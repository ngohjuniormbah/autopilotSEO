import type { Metadata } from "next";
import AuthScreen from "@/components/auth-screen";

export const metadata: Metadata = { title: "Get started", robots: { index: false, follow: false } };

export default function SignupPage() { return <AuthScreen mode="signup" />; }
