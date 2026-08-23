/**
 * Seed — idempotent demo dataset for Meridian Market.
 * Run: bunx bun prisma/seed.ts   (or `bun run db:seed`)
 *
 * Demo accounts (all passwords shown are for local development only):
 *   admin@meridian.dev    / Admin123!    → platform admin
 *   velocity@meridian.dev / Vendor123!   → Velocity Athletics (ACTIVE)
 *   nordic@meridian.dev   / Vendor123!   → Nordic Audio Lab (ACTIVE)
 *   terra@meridian.dev    / Vendor123!   → Terra Home Goods (ACTIVE)
 *   pixelforge@meridian.dev / Vendor123! → Pixel Forge Studio (PENDING — demo admin approval)
 *   casey@meridian.dev    / Customer123! → shopper
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function main(): Promise<void> {
  console.log("🌱 Seeding Meridian Market…");

  // Idempotent: wipe transactional data in FK-safe order.
  await db.chatMessage.deleteMany();
  await db.chatSession.deleteMany();
  await db.session.deleteMany();
  await db.payout.deleteMany();
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.product.deleteMany();
  await db.store.deleteMany();
  await db.user.deleteMany();

  const admin = await db.user.create({
    data: { email: "admin@meridian.dev", name: "Ada Merchant", passwordHash: hashPassword("Admin123!"), role: "ADMIN" },
  });
  const casey = await db.user.create({
    data: { email: "casey@meridian.dev", name: "Casey Shopper", passwordHash: hashPassword("Customer123!"), role: "CUSTOMER" },
  });
  void casey;

  const storeDefs = [
    {
      email: "velocity@meridian.dev",
      vendorName: "Vera Velocity",
      name: "Velocity Athletics",
      slug: "velocity-athletics",
      description: "Performance gear for runners who chase sunrise PRs.",
      logoEmoji: "🏃",
      status: "ACTIVE",
    },
    {
      email: "nordic@meridian.dev",
      vendorName: "Nils Nordic",
      name: "Nordic Audio Lab",
      slug: "nordic-audio-lab",
      description: "Precision-tuned audio equipment from the fjord country.",
      logoEmoji: "🎧",
      status: "ACTIVE",
    },
    {
      email: "terra@meridian.dev",
      vendorName: "Tessa Terra",
      name: "Terra Home Goods",
      slug: "terra-home-goods",
      description: "Handcrafted, sustainable goods for slow living.",
      logoEmoji: "🌿",
      status: "ACTIVE",
    },
    {
      email: "pixelforge@meridian.dev",
      vendorName: "Piper Pixel",
      name: "Pixel Forge Studio",
      slug: "pixel-forge-studio",
      description: "Desk setup essentials forged for makers.",
      logoEmoji: "⚡",
      status: "PENDING", // demonstrates the admin approval workflow
    },
  ];

  const stores = new Map<string, string>(); // slug → storeId
  for (const def of storeDefs) {
    const vendor = await db.user.create({
      data: { email: def.email, name: def.vendorName, passwordHash: hashPassword("Vendor123!"), role: "VENDOR" },
    });
    const store = await db.store.create({
      data: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        logoEmoji: def.logoEmoji,
        status: def.status,
        commissionRate: 0.1,
        vendorId: vendor.id,
      },
    });
    stores.set(def.slug, store.id);
  }

  type ProductSeed = {
    slug: string;
    name: string;
    description: string;
    priceCents: number;
    compareAtPriceCents?: number;
    imageUrl: string;
    category: string;
    tags: string;
    stock: number;
    rating: number;
    reviewCount: number;
    featured: boolean;
    storeSlug: string;
  };

  const products: ProductSeed[] = [
    {
      slug: "glideflow-running-shoes",
      name: "GlideFlow Running Shoes",
      description:
        "Featherweight trainers with a responsive nitrogen-infused midsole and a 6mm drop. Built for daily miles and tempo days alike, with a breathable engineered-mesh upper.",
      priceCents: 8999,
      compareAtPriceCents: 11999,
      imageUrl: "/products/glideflow-running-shoes.jpg",
      category: "Footwear",
      tags: "running,shoes,sneakers,jogging,sport,training,marathon",
      stock: 42,
      rating: 4.7,
      reviewCount: 214,
      featured: true,
      storeSlug: "velocity-athletics",
    },
    {
      slug: "aerolite-windbreaker",
      name: "AeroLite Windbreaker",
      description:
        "A 148g packable windbreaker with a DWR finish and laser-cut vents. Shrugs off headwinds and drizzle, then stuffs into its own chest pocket.",
      priceCents: 12999,
      imageUrl: "/products/aerolite-windbreaker.jpg",
      category: "Apparel",
      tags: "jacket,windbreaker,running,outdoor,water-resistant,hoodie",
      stock: 28,
      rating: 4.5,
      reviewCount: 96,
      featured: false,
      storeSlug: "velocity-athletics",
    },
    {
      slug: "pulse-heart-rate-band",
      name: "Pulse Heart-Rate Band",
      description:
        "Continuous heart-rate monitoring with 14-day battery, sleep-stage tracking and a screen you can read in direct sun. Syncs over Bluetooth to any training app.",
      priceCents: 5999,
      compareAtPriceCents: 7999,
      imageUrl: "/products/pulse-heart-band.jpg",
      category: "Fitness",
      tags: "fitness,heart-rate,tracker,wearable,running,health,band",
      stock: 65,
      rating: 4.4,
      reviewCount: 178,
      featured: true,
      storeSlug: "velocity-athletics",
    },
    {
      slug: "stridepro-compression-socks",
      name: "StridePro Compression Socks",
      description:
        "Graduated 15–20 mmHg compression in a moisture-wicking knit. Calf support for long runs, flights and desk days.",
      priceCents: 2499,
      imageUrl: "/products/stridepro-socks.jpg",
      category: "Apparel",
      tags: "socks,compression,running,recovery,sport",
      stock: 120,
      rating: 4.3,
      reviewCount: 64,
      featured: false,
      storeSlug: "velocity-athletics",
    },
    {
      slug: "aurora-wireless-headphones",
      name: "Aurora Wireless Headphones",
      description:
        "Over-ear wireless headphones with adaptive hybrid noise cancelling, 42-hour battery and a warm, detailed tuning hand-finished in our Bergen lab.",
      priceCents: 19999,
      compareAtPriceCents: 24999,
      imageUrl: "/products/aurora-headphones.jpg",
      category: "Audio",
      tags: "headphones,audio,wireless,noise-cancelling,music,anc,over-ear",
      stock: 33,
      rating: 4.8,
      reviewCount: 341,
      featured: true,
      storeSlug: "nordic-audio-lab",
    },
    {
      slug: "echobud-pro-earbuds",
      name: "EchoBud Pro Earbuds",
      description:
        "True-wireless earbuds with feed-forward ANC, wireless charging and IPX5 sweat resistance. Six hours per charge, 26 with the case.",
      priceCents: 14999,
      imageUrl: "/products/echobud-earbuds.jpg",
      category: "Audio",
      tags: "earbuds,audio,wireless,anc,noise-cancelling,music,commute",
      stock: 51,
      rating: 4.5,
      reviewCount: 267,
      featured: false,
      storeSlug: "nordic-audio-lab",
    },
    {
      slug: "bassmonk-speaker",
      name: "BassMonk Speaker",
      description:
        "A 360° portable speaker in walnut and acoustic fabric. 20W of surprisingly deep bass, 18-hour battery and IPX4 for balcony duty.",
      priceCents: 9999,
      imageUrl: "/products/bassmonk-speaker.jpg",
      category: "Audio",
      tags: "speaker,bluetooth,audio,portable,music,bass",
      stock: 44,
      rating: 4.6,
      reviewCount: 152,
      featured: true,
      storeSlug: "nordic-audio-lab",
    },
    {
      slug: "ember-ceramic-mug-set",
      name: "Ember Ceramic Mug Set",
      description:
        "Set of two hand-thrown speckled stoneware mugs, glazed in warm terracotta. Each holds 350ml and forgives the dishwasher.",
      priceCents: 3499,
      imageUrl: "/products/ember-mugs.jpg",
      category: "Home & Kitchen",
      tags: "mug,ceramic,coffee,tea,kitchen,handmade,tableware",
      stock: 80,
      rating: 4.9,
      reviewCount: 411,
      featured: true,
      storeSlug: "terra-home-goods",
    },
    {
      slug: "cedar-cutting-board",
      name: "Cedar Cutting Board",
      description:
        "End-grain cedar board with a juice groove and comfortable bevel. 38 × 25cm of knife-kind, naturally aromatic prep surface.",
      priceCents: 4999,
      imageUrl: "/products/cedar-board.jpg",
      category: "Home & Kitchen",
      tags: "cutting board,kitchen,wood,cedar,cooking,chef",
      stock: 37,
      rating: 4.7,
      reviewCount: 128,
      featured: false,
      storeSlug: "terra-home-goods",
    },
    {
      slug: "linen-throw-blanket",
      name: "Linen Throw Blanket",
      description:
        "Stonewashed European flax throw in sage. Breathable in summer, layered warmth in winter, softer with every wash. 130 × 180cm.",
      priceCents: 7999,
      imageUrl: "/products/linen-blanket.jpg",
      category: "Home & Kitchen",
      tags: "blanket,linen,throw,home,living room,cozy,sofa",
      stock: 26,
      rating: 4.8,
      reviewCount: 89,
      featured: false,
      storeSlug: "terra-home-goods",
    },
    {
      slug: "nomad-65w-gan-charger",
      name: "Nomad 65W GaN Charger",
      description:
        "Pocket 65W GaN charger with two USB-C PD ports and one USB-A. Charges a laptop, tablet and phone from one outlet.",
      priceCents: 4599,
      compareAtPriceCents: 5599,
      imageUrl: "/products/nomad-charger.jpg",
      category: "Tech Accessories",
      tags: "charger,gan,usb-c,pd,fast charging,travel,tech",
      stock: 95,
      rating: 4.6,
      reviewCount: 203,
      featured: true,
      storeSlug: "pixel-forge-studio",
    },
    {
      slug: "lumina-desk-lamp",
      name: "Lumina Desk Lamp",
      description:
        "Minimal matte-black desk lamp with stepless dimming from 2700K candlelight to 5000K daylight, and a USB-C port in the base.",
      priceCents: 6999,
      imageUrl: "/products/lumina-lamp.jpg",
      category: "Tech Accessories",
      tags: "lamp,desk,led,lighting,tech,workspace,usb-c",
      stock: 48,
      rating: 4.5,
      reviewCount: 117,
      featured: false,
      storeSlug: "pixel-forge-studio",
    },
  ];

  for (const p of products) {
    await db.product.create({
      data: {
        name: p.name,
        slug: p.slug,
        description: p.description,
        priceCents: p.priceCents,
        compareAtPriceCents: p.compareAtPriceCents ?? null,
        imageUrl: p.imageUrl,
        category: p.category,
        tags: p.tags,
        stock: p.stock,
        rating: p.rating,
        reviewCount: p.reviewCount,
        featured: p.featured,
        storeId: stores.get(p.storeSlug)!,
      },
    });
  }

  console.log(`✅ Seeded: 1 admin, 4 vendors (1 pending), 1 customer, 4 stores, ${products.length} products.`);
  console.log(`   Admin: ${admin.email} / Admin123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
