"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { SessionUser } from "@/lib/client/types";
import { Header } from "@/components/marketplace/header";
import { AuthDialog } from "@/components/marketplace/auth-dialog";
import { AiAssistant } from "@/components/marketplace/ai-assistant";
import { HomeView } from "@/components/marketplace/views/home";
import { ProductView } from "@/components/marketplace/views/product";
import { CartView } from "@/components/marketplace/views/cart";
import { CheckoutView } from "@/components/marketplace/views/checkout";
import { OrdersView } from "@/components/marketplace/views/orders";
import { VendorDashboard } from "@/components/marketplace/dashboards/vendor";
import { AdminDashboard } from "@/components/marketplace/dashboards/admin";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Store } from "lucide-react";

function ViewRouter() {
  const view = useApp((s) => s.view);
  const user = useApp((s) => s.user);
  const authReady = useApp((s) => s.authReady);

  if (view.name === "dashboard") {
    if (!authReady) return null;
    if (!user || user.role === "CUSTOMER") {
      return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-20 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold">Vendor &amp; admin area</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sign in with a vendor or admin account to open the operations dashboard.
          </p>
          <Button onClick={() => useApp.getState().openAuth("login")}>Sign in</Button>
        </div>
      );
    }
    if (user.role === "ADMIN") return <AdminDashboard />;
    return <VendorDashboard />;
  }

  switch (view.name) {
    case "product":
      return <ProductView id={view.id} />;
    case "cart":
      return <CartView />;
    case "checkout":
      return <CheckoutView />;
    case "orders":
      return <OrdersView />;
    default:
      return <HomeView />;
  }
}

function Footer() {
  const navigate = useApp((s) => s.navigate);
  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div className="space-y-2">
          <button className="flex items-center gap-2 font-semibold" onClick={() => navigate({ name: "home" })}>
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Store className="size-4" aria-hidden />
            </span>
            Meridian Market
          </button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Carefully chosen goods from a small circle of independent makers.
            Vendors keep 90% of every sale.
          </p>
        </div>
        <nav className="space-y-1.5 text-sm" aria-label="Shop">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shop</p>
          <button className="block text-muted-foreground hover:text-foreground" onClick={() => navigate({ name: "home" })}>Catalog</button>
          <button className="block text-muted-foreground hover:text-foreground" onClick={() => navigate({ name: "cart" })}>Cart</button>
          <button className="block text-muted-foreground hover:text-foreground" onClick={() => navigate({ name: "orders" })}>Orders</button>
        </nav>
        <nav className="space-y-1.5 text-sm" aria-label="Platform">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platform</p>
          <button className="block text-muted-foreground hover:text-foreground" onClick={() => useApp.getState().openAuth("signup")}>Become a vendor</button>
          <span className="block text-muted-foreground">Transparent 10% commission</span>
          <span className="block text-muted-foreground">Secure split checkout</span>
        </nav>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Meridian Market. All rights reserved.
      </div>
    </footer>
  );
}

export function MarketplaceApp() {
  const initRouter = useApp((s) => s.initRouter);
  const setAuth = useApp((s) => s.setAuth);
  const setCartCount = useApp((s) => s.setCartCount);

  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: SessionUser | null; cartCount: number }>("/api/auth/me"),
  });

  useEffect(() => {
    initRouter();
  }, [initRouter]);

  useEffect(() => {
    if (data) {
      setAuth(data.user);
      setCartCount(data.cartCount);
      useApp.setState({ authReady: true });
    }
  }, [data, setAuth, setCartCount]);

  const view = useApp((s) => s.view);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6" id="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={view.name === "product" ? `product-${view.id}` : view.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <ViewRouter />
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <AuthDialog />
      <AiAssistant />
    </div>
  );
}
