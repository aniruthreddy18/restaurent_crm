import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Restaurant CRM",
  description: "Order, customer and delivery management for WhatsApp-first restaurants",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
