import type { Metadata } from "next";
import AuthScreen from "@/components/auth-screen";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };

export default function LoginPage() { return <AuthScreen mode="login" />; }
