/** Pure-logic units: phone identity, tiering, totals and webhook signing. */
import { describe, expect, it } from "vitest";
import { normalizeWhatsAppNumber, formatWhatsAppNumber } from "@/lib/phone";
import { deriveCustomerType, DEFAULT_TIER_CONFIG, tierConfigFromSettings } from "@/server/modules/customers/customer.rules";
import { computeOrderTotals } from "@/server/modules/orders/order.service";
import { signPayload, verifySignature } from "@/server/events/signature";
import { sanitizePaymentMetadata } from "@/server/modules/payments/payment.schema";
import { assertTransition } from "@/server/modules/orders/order.status";

describe("WhatsApp number normalisation", () => {
  it("collapses every common format to the same identity", () => {
    const expected = "919876543210";
    for (const input of [
      "919876543210",
      "+919876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "0091 9876543210",
      "9876543210",
      "09876543210",
      "(+91) 98765 43210",
    ]) {
      expect(normalizeWhatsAppNumber(input, "91")).toBe(expected);
    }
  });

  it("respects a different default country code", () => {
    expect(normalizeWhatsAppNumber("5551234567", "1")).toBe("15551234567");
  });

  it("rejects input that cannot be a phone number", () => {
    expect(() => normalizeWhatsAppNumber("", "91")).toThrow();
    expect(() => normalizeWhatsAppNumber("abc", "91")).toThrow();
    expect(() => normalizeWhatsAppNumber("9999999999999999999", "91")).toThrow();
  });

  it("formats for display without changing the stored value", () => {
    expect(formatWhatsAppNumber("919876543210")).toBe("+91 98765 43210");
  });
});

describe("customer tiering", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const recent = new Date("2026-05-28T00:00:00Z");

  it("climbs the tiers with order volume", () => {
    expect(deriveCustomerType({ totalOrders: 0, totalSpent: 0, lastOrderAt: null }, DEFAULT_TIER_CONFIG, now)).toBe("NEW");
    expect(deriveCustomerType({ totalOrders: 1, totalSpent: 500, lastOrderAt: recent }, DEFAULT_TIER_CONFIG, now)).toBe("NEW");
    expect(deriveCustomerType({ totalOrders: 3, totalSpent: 1500, lastOrderAt: recent }, DEFAULT_TIER_CONFIG, now)).toBe("REGULAR");
    expect(deriveCustomerType({ totalOrders: 6, totalSpent: 3000, lastOrderAt: recent }, DEFAULT_TIER_CONFIG, now)).toBe("LOYAL");
    expect(deriveCustomerType({ totalOrders: 12, totalSpent: 6000, lastOrderAt: recent }, DEFAULT_TIER_CONFIG, now)).toBe("VIP");
  });

  it("promotes high spenders regardless of order count", () => {
    expect(deriveCustomerType({ totalOrders: 2, totalSpent: 15000, lastOrderAt: recent }, DEFAULT_TIER_CONFIG, now)).toBe("VIP");
  });

  it("marks dormant customers INACTIVE even if they used to be VIP", () => {
    const longAgo = new Date("2025-01-01T00:00:00Z");
    expect(deriveCustomerType({ totalOrders: 30, totalSpent: 90000, lastOrderAt: longAgo }, DEFAULT_TIER_CONFIG, now)).toBe("INACTIVE");
  });

  it("is configurable per restaurant without a code change", () => {
    const config = tierConfigFromSettings({ customerTiers: { vipMinOrders: 3, inactiveAfterDays: 365 } });
    expect(config.vipMinOrders).toBe(3);
    expect(config.inactiveAfterDays).toBe(365);
    // Unspecified keys fall back to the defaults.
    expect(config.loyalMinOrders).toBe(DEFAULT_TIER_CONFIG.loyalMinOrders);
    expect(deriveCustomerType({ totalOrders: 3, totalSpent: 0, lastOrderAt: recent }, config, now)).toBe("VIP");
  });
});

describe("order totals", () => {
  it("adds fees and tax and subtracts the discount", () => {
    const totals = computeOrderTotals(
      [
        { name: "A", price: 420, quantity: 1 },
        { name: "B", price: 90, quantity: 2 },
      ],
      40,
      100,
      30,
    );
    expect(totals.subtotal.toString()).toBe("600");
    expect(totals.totalAmount.toString()).toBe("570"); // 600 + 40 - 100 + 30
  });

  it("never produces a negative charge", () => {
    const totals = computeOrderTotals([{ name: "A", price: 100, quantity: 1 }], 0, 500, 0);
    expect(totals.totalAmount.toString()).toBe("0");
  });

  it("keeps money exact to 2dp rather than using floats", () => {
    const totals = computeOrderTotals([{ name: "A", price: 0.1, quantity: 3 }], 0, 0, 0);
    expect(totals.subtotal.toString()).toBe("0.3");
  });
});

describe("webhook signatures", () => {
  it("verifies a signature it just produced", () => {
    const body = JSON.stringify({ type: "ORDER_READY" });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload("secret", body, timestamp);
    expect(verifySignature("secret", body, timestamp, signature)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body and a stale timestamp", () => {
    const body = JSON.stringify({ type: "ORDER_READY" });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload("secret", body, timestamp);

    expect(verifySignature("other-secret", body, timestamp, signature)).toBe(false);
    expect(verifySignature("secret", '{"type":"ORDER_CANCELLED"}', timestamp, signature)).toBe(false);
    // Replay of a captured delivery an hour later.
    const old = timestamp - 3600;
    expect(verifySignature("secret", body, old, signPayload("secret", body, old))).toBe(false);
  });
});

describe("payment metadata hygiene", () => {
  it("redacts anything resembling cardholder data", () => {
    const clean = sanitizePaymentMetadata({
      rrn: "123456",
      card_number: "4111111111111111",
      cvv: "123",
      upiId: "someone@bank",
      "Card Number": "4111111111111111",
      pin: "0000",
    });

    expect(clean.rrn).toBe("123456");
    expect(clean.upiId).toBe("someone@bank");
    expect(clean.card_number).toBe("[redacted]");
    expect(clean["Card Number"]).toBe("[redacted]");
    expect(clean.cvv).toBe("[redacted]");
    expect(clean.pin).toBe("[redacted]");
  });
});

describe("status machine", () => {
  it("allows only forward moves", () => {
    expect(() => assertTransition("CONFIRMED", "PREPARING")).not.toThrow();
    expect(() => assertTransition("READY", "OUT_FOR_DELIVERY")).not.toThrow();
    expect(() => assertTransition("CONFIRMED", "READY")).toThrow();
    expect(() => assertTransition("DELIVERED", "PREPARING")).toThrow();
    expect(() => assertTransition("READY", "READY")).toThrow();
  });
});
