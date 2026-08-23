"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { SessionUser } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Store, User } from "lucide-react";

interface AuthResponse {
  user: SessionUser;
}

export function AuthDialog() {
  const { authOpen, authMode, closeAuth, setAuth, setCartCount } = useApp();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"login" | "signup">(authMode);
  const [role, setRole] = useState<"CUSTOMER" | "VENDOR">("CUSTOMER");
  const [busy, setBusy] = useState(false);

  // login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  // signup form
  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeDescription, setStoreDescription] = useState("");

  const open = authOpen;
  const onOpenChange = (v: boolean) => {
    if (!v) closeAuth();
    else useApp.getState().openAuth(tab);
  };

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: SessionUser | null; cartCount: number }>("/api/auth/me"),
  });
  void meData;

  const afterAuth = (user: SessionUser) => {
    setAuth(user);
    queryClient.invalidateQueries();
    // refresh cart badge after guest→user merge
    void api<{ itemCount: number }>("/api/cart").then((c) => setCartCount(c.itemCount));
    closeAuth();
    toast.success(`Welcome, ${user.name.split(" ")[0]}`, {
      description: user.role === "VENDOR" ? "Your vendor workspace is ready." : undefined,
    });
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      afterAuth(res.user);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<AuthResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name,
          email: signupEmail,
          password: signupPassword,
          role,
          ...(role === "VENDOR" ? { storeName, storeDescription } : {}),
        }),
      });
      afterAuth(res.user);
      if (role === "VENDOR") {
        toast.info("Store submitted for review", {
          description: "An admin will approve your store. You can add products meanwhile.",
        });
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const quickFill = (email: string, password: string) => {
    setTab("login");
    setLoginEmail(email);
    setLoginPassword(password);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Meridian Market</DialogTitle>
          <DialogDescription>
            Sign in to continue, or create an account. Shoppers, vendors and platform admins use the same door.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={submitLogin} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input id="login-email" type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input id="login-password" type="password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Demo accounts — one click to fill:</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => quickFill("admin@meridian.dev", "Admin123!")}>
                    <User className="mr-1 size-3.5" /> Admin
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => quickFill("velocity@meridian.dev", "Vendor123!")}>
                    <Store className="mr-1 size-3.5" /> Vendor
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => quickFill("casey@meridian.dev", "Customer123!")}>
                    <User className="mr-1 size-3.5" /> Customer
                  </Button>
                </div>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={submitSignup} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={role === "CUSTOMER" ? "default" : "outline"} size="sm" onClick={() => setRole("CUSTOMER")}>
                  <User className="mr-1 size-3.5" /> Shopper
                </Button>
                <Button type="button" variant={role === "VENDOR" ? "default" : "outline"} size="sm" onClick={() => setRole("VENDOR")}>
                  <Store className="mr-1 size-3.5" /> Vendor
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="su-name">Full name</Label>
                <Input id="su-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-email">Email</Label>
                <Input id="su-email" type="email" required maxLength={160} value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-password">Password</Label>
                <Input id="su-password" type="password" required minLength={8} value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} autoComplete="new-password" />
                <p className="text-xs text-muted-foreground">8+ characters with a letter and a number or symbol.</p>
              </div>

              {role === "VENDOR" && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Badge className="mb-1" variant="secondary">Store onboarding</Badge>
                  <div className="space-y-2">
                    <Label htmlFor="su-store">Store name</Label>
                    <Input id="su-store" required maxLength={80} value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. Alpine Coffee Co." />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-store-desc">What do you sell?</Label>
                    <Input id="su-store-desc" maxLength={200} value={storeDescription} onChange={(e) => setStoreDescription(e.target.value)} placeholder="One sentence about your store" />
                  </div>
                  <p className="text-xs text-muted-foreground">New stores go live after admin approval. Platform commission: 10%.</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : role === "VENDOR" ? "Create vendor account" : "Create account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
