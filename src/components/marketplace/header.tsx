"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Store,
  ShoppingCart,
  Search,
  Sparkles,
  Package,
  LayoutDashboard,
  LogOut,
  ChevronDown,
  UserRound,
} from "lucide-react";

const CATEGORIES = ["Footwear", "Apparel", "Fitness", "Audio", "Home & Kitchen", "Tech Accessories"];

export function Header() {
  const {
    user,
    cartCount,
    navigate,
    openAuth,
    openAssistant,
    search,
    setSearch,
    category,
    setCategory,
    view,
  } = useApp();
  const queryClient = useQueryClient();

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      useApp.getState().setAuth(null);
      useApp.getState().setCartCount(0);
      queryClient.clear();
      toast.success("Signed out");
      navigate({ name: "home" });
    } catch {
      toast.error("Sign out failed.");
    }
  };

  const roleBadge =
    user?.role === "ADMIN" ? "Admin" : user?.role === "VENDOR" ? "Vendor" : null;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <button
          className="flex items-center gap-2 font-semibold tracking-tight"
          onClick={() => navigate({ name: "home" })}
          aria-label="Meridian Market home"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-4.5" aria-hidden />
          </span>
          <span className="hidden text-lg sm:inline">Meridian Market</span>
        </button>

        <form
          className="relative ml-2 hidden flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ name: "home" });
          }}
          role="search"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (view.name !== "home") navigate({ name: "home" });
            }}
            placeholder="Search products, brands, categories…"
            className="pl-9"
            aria-label="Search products"
            maxLength={120}
          />
        </form>

        <nav className="ml-auto flex items-center gap-1.5" aria-label="Primary">
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-1.5 lg:flex"
            onClick={() => openAssistant()}
          >
            <Sparkles className="size-4 text-primary" aria-hidden />
            Ask Aria
          </Button>

          <Button variant="ghost" size="sm" className="relative" onClick={() => navigate({ name: "cart" })} aria-label={`Cart, ${cartCount} items`}>
            <ShoppingCart className="size-4.5" aria-hidden />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
                  <Avatar className="size-6">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {user.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-28 truncate sm:inline">{user.name.split(" ")[0]}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span className="truncate">{user.email}</span>
                </DropdownMenuLabel>
                {roleBadge && <DropdownMenuItem disabled><Badge variant="secondary">{roleBadge}</Badge></DropdownMenuItem>}
                <DropdownMenuSeparator />
                {user.role !== "CUSTOMER" && (
                  <DropdownMenuItem onClick={() => navigate({ name: "dashboard" })}>
                    <LayoutDashboard className="mr-2 size-4" aria-hidden /> Dashboard
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate({ name: "orders" })}>
                  <Package className="mr-2 size-4" aria-hidden /> My orders
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ name: "cart" })}>
                  <ShoppingCart className="mr-2 size-4" aria-hidden /> Cart
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} variant="destructive">
                  <LogOut className="mr-2 size-4" aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAuth("login")}>
              <UserRound className="size-4" aria-hidden />
              Sign in
            </Button>
          )}
        </nav>
      </div>

      {/* Category rail */}
      <div className="border-t bg-muted/30">
        <div className="custom-scroll mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto px-4 py-2 sm:px-6" role="navigation" aria-label="Categories">
          <button
            onClick={() => {
              setCategory("all");
              navigate({ name: "home" });
            }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === "all" ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-accent"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => {
                setCategory(c);
                navigate({ name: "home" });
              }}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === c ? "bg-primary text-primary-foreground" : "bg-background border hover:bg-accent"
              }`}
              aria-pressed={category === c}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
