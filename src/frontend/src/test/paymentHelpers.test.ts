import { describe, expect, it } from "vitest";
import {
  formatPrice,
  parsePayment,
  parsePaymentUrl,
  parsePrice,
  PAYMENT_URL_ERROR,
  PAYMENT_URL_LENGTH_ERROR,
  PAYMENT_URL_REQUIRES_PRICE_ERROR,
  PRICE_ERROR,
  priceText,
} from "../utils/appHelpers";

describe("payment helpers", () => {
  it.each([
    ["25", "25.00"],
    ["25,5", "25.50"],
    ["25.5", "25.50"],
    ["0025", "25.00"],
    ["0,5", "0.50"],
    ["1 000,50", "1000.50"],
    ["1\u00a0000,50", "1000.50"],
    [" 12,34 ", "12.34"],
    ["", null],
    ["   ", null],
    ["100000", "100000.00"],
    ["0", undefined],
    ["0,00", undefined],
    ["100000,01", undefined],
    ["1,234", undefined],
    ["abc", undefined],
    ["-5", undefined],
    ["1e3", undefined],
  ])("parsePrice(%j) is %j", (raw, expected) => {
    expect(parsePrice(raw)).toBe(expected);
  });

  it("formats a stored price for display and for the input", () => {
    expect(formatPrice("25.50").replace(/[\u00a0\u202f]/g, " ")).toBe("25,50 zł");
    expect(priceText("25.50")).toBe("25,50");
    expect(priceText(null)).toBe("");
    expect(priceText(undefined)).toBe("");
  });

  it("parsePaymentUrl returns the trimmed input as typed, https only", () => {
    expect(parsePaymentUrl(" https://x.pl ")).toBe("https://x.pl");
    expect(parsePaymentUrl("https://buy.stripe.com/abc123")).toBe("https://buy.stripe.com/abc123");
    expect(parsePaymentUrl("")).toBeNull();
    expect(parsePaymentUrl("   ")).toBeNull();
    expect(parsePaymentUrl("http://x.pl")).toBeUndefined();
    expect(parsePaymentUrl("javascript:alert(1)")).toBeUndefined();
    expect(parsePaymentUrl("https://")).toBeUndefined();
    expect(parsePaymentUrl("https://x.pl/a b")).toBeUndefined();
    expect(parsePaymentUrl(`https://x.pl/${"a".repeat(488)}`)).toBeUndefined();
    expect(parsePaymentUrl(`https://x.pl/${"a".repeat(487)}`)).toHaveLength(500);
  });

  it.each([
    ["https:example.com"],
    ["https:\\example.com"],
    ["https:/example.com"],
    ["https://x.pl/\u200bpay"],
    ["https://x.pl/\u0085"],
    ["https://x.pl/\tpay"],
    ["https://a@evil.tld"],
    ["https://bank.pl:secret@evil.tld"],
    ["https://@x.pl"],
    ["https://:@x.pl"],
    ["https://x.pl\\@evil.tld"],
    ["https://x.pl\\pay"],
  ])("parsePaymentUrl rejects %j like the server does", (raw) => {
    expect(parsePaymentUrl(raw)).toBeUndefined();
  });

  it("parsePaymentUrl accepts an upper-case scheme as typed", () => {
    expect(parsePaymentUrl("HTTPS://x.pl/Pay")).toBe("HTTPS://x.pl/Pay");
  });

  it("parsePaymentUrl allows an @ after the host (path or query)", () => {
    expect(parsePaymentUrl("https://x.pl/u/@jan?to=a@b.pl")).toBe("https://x.pl/u/@jan?to=a@b.pl");
  });

  it("parsePayment is the submit gate including the link-requires-price rule", () => {
    expect(parsePayment("25,5", " https://x.pl ")).toEqual({ price: "25.50", payment_url: "https://x.pl" });
    expect(parsePayment("25", "")).toEqual({ price: "25.00", payment_url: null });
    expect(parsePayment("", "")).toEqual({ price: null, payment_url: null });
    expect(parsePayment("", "https://x.pl")).toBeUndefined();
    expect(parsePayment("abc", "")).toBeUndefined();
    expect(parsePayment("25", "http://x.pl")).toBeUndefined();
  });

  it("error constants match the shared copy table", () => {
    expect(PRICE_ERROR).toBe("Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste.");
    expect(PAYMENT_URL_ERROR).toBe("Link musi zaczynać się od https://");
    expect(PAYMENT_URL_LENGTH_ERROR).toBe("Link do płatności może mieć najwyżej 500 znaków.");
    expect(PAYMENT_URL_REQUIRES_PRICE_ERROR).toBe("Link wymaga ceny — wpisz cenę albo usuń link.");
  });
});
