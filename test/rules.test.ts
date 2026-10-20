import { describe, expect, it } from "vitest";
import { electionDayTime, isClosed, isInsideRideWindow, parseInstant } from "../src/election";
import { foldForSearch, looksLikeCampaign } from "../src/text";
import { networkKey, tokenMatches, sha256Hex } from "../src/crypto";
import { normalizeWhatsapp } from "../src/whatsapp";

describe("normalizeWhatsapp", () => {
  it.each([
    ["(81) 99876-5432", "+5581998765432"],
    ["81998765432", "+5581998765432"],
    ["+55 81 99876-5432", "+5581998765432"],
    ["5511987654321", "+5511987654321"],
    ["081 99876 5432", "+5581998765432"],
    ["55 91234-5678", "+5555912345678"],
    ["0 81 99876-5432", "+5581998765432"],
    ["055 81 99876-5432", "+5581998765432"],
    ["0055 81 99876-5432", "+5581998765432"],
    ["00 55 81 99876 5432", "+5581998765432"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeWhatsapp(input)).toBe(expected);
  });

  it.each([
    ["landline", "(81) 3456-7890"],
    ["mobile without the 9", "(81) 8876-5432"],
    ["invalid DDD 10", "(10) 99876-5432"],
    ["invalid DDD 23", "(23) 99876-5432"],
    ["invalid DDD 20", "(20) 99876-5432"],
    ["too short", "9987654"],
    ["too long", "+55 81 99876-54321"],
    ["foreign country code", "+1 415 555 0100"],
    ["letters", "81 9abc-5432"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(normalizeWhatsapp(input)).toBeNull();
  });
});

describe("neutrality screen", () => {
  it.each([
    "Praça 13 de Maio",
    "Rua 22 de Agosto, 13",
    "Av. Conde da Boa Vista",
    "Posto em frente ao mercado",
    "Pto de ônibus",
    "Levo cadeira de rodas",
    "Saio da Rua Ptolomeu",
  ])("accepts %s", (text) => {
    expect(looksLikeCampaign(text)).toBe(false);
  });

  it.each([
    "vote 13",
    "Vote 22!",
    "voto no 13",
    "vote em fulano",
    "voto em ciclano",
    "Lula",
    "LULA lá",
    "Bolsonaro",
    "PT",
    "carona do pt",
    "PL",
    "Tarcísio",
    "Tarcisio",
    "Marçal",
    "13 confirma",
    "número 22",
    "bolsonaro2026",
    "Alfredo Gaspar",
    "votem em quem quiser",
    "L\u200bula",
    "Bolso\u00adnaro",
    "ＬＵＬＡ",
    "vote\u2060 13",
    "P\u200dT",
    "petista",
    "bolsonarista",
  ])("rejects %s", (text) => {
    expect(looksLikeCampaign(text)).toBe(true);
  });
});

describe("foldForSearch", () => {
  it("lowercases, strips accents and collapses spaces", () => {
    expect(foldForSearch("  São   JOSÉ  ")).toBe("sao jose");
  });
});

describe("election time helpers", () => {
  it("accepts only ISO timestamps with an explicit offset", () => {
    expect(parseInstant("2026-10-25T10:00:00-03:00")?.toISOString()).toBe("2026-10-25T13:00:00.000Z");
    expect(parseInstant("2026-10-25T13:00Z")?.toISOString()).toBe("2026-10-25T13:00:00.000Z");
    expect(parseInstant("2026-10-25T10:00:00")).toBeNull();
    expect(parseInstant("25/10/2026 10:00")).toBeNull();
    expect(parseInstant(1_761_400_000_000)).toBeNull();
  });

  it("checks the ride window inclusively", () => {
    expect(isInsideRideWindow(new Date("2026-10-25T09:00:00-03:00"))).toBe(true);
    expect(isInsideRideWindow(new Date("2026-10-25T17:00:00-03:00"))).toBe(true);
    expect(isInsideRideWindow(new Date("2026-10-25T08:59:59-03:00"))).toBe(false);
    expect(isInsideRideWindow(new Date("2026-10-25T17:00:01-03:00"))).toBe(false);
    expect(isInsideRideWindow(new Date("2026-10-24T10:00:00-03:00"))).toBe(false);
  });

  it("converts HH:MM on election day to an instant in BRT", () => {
    expect(electionDayTime("09:30")?.toISOString()).toBe("2026-10-25T12:30:00.000Z");
    expect(electionDayTime("9:30")).toBeNull();
    expect(electionDayTime("24:00")).toBeNull();
  });

  it("closes at the purge instant", () => {
    expect(isClosed(new Date("2026-10-25T19:59:59Z"))).toBe(false);
    expect(isClosed(new Date("2026-10-25T20:00:00Z"))).toBe(true);
  });
});

describe("networkKey", () => {
  it("keeps IPv4 addresses whole", () => {
    expect(networkKey("203.0.113.9")).toBe("203.0.113.9");
    expect(networkKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("reduces IPv6 addresses to their /64", () => {
    const key = "2001:0db8:0001:0002::/64";
    expect(networkKey("2001:db8:1:2::1")).toBe(key);
    expect(networkKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(networkKey("2001:DB8:1:2:0:0:0:ffff")).toBe(key);
    expect(networkKey("2001:db8:1:3::1")).not.toBe(key);
    expect(networkKey("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("falls back to the raw value for malformed input", () => {
    expect(networkKey("unknown")).toBe("unknown");
    expect(networkKey("1::2::3")).toBe("1::2::3");
  });
});

describe("tokenMatches", () => {
  it("compares tokens against stored digests", async () => {
    const stored = await sha256Hex("a-long-enough-token");
    expect(await tokenMatches("a-long-enough-token", stored)).toBe(true);
    expect(await tokenMatches("another-token-value", stored)).toBe(false);
    expect(await tokenMatches("a-long-enough-token", "not-hex")).toBe(false);
  });
});
