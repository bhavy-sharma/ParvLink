import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { describeAuthError, describeDbError } from "@/lib/auth/errors";
import { GENERIC_ERROR } from "@/lib/form-state";
import { toAvatarWebp, UnsupportedImageError } from "@/lib/images";

const photo = (width, height, format = "jpeg") =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .withExif({ IFD0: { Copyright: "secret-owner", Make: "PhoneMaker" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 33/1" } })
    .toFormat(format)
    .toBuffer();

describe("profile photo re-encoding", () => {
  test("outputs a 512×512 WebP", async () => {
    const out = await toAvatarWebp(await photo(1600, 900));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  test("strips EXIF, including GPS position", async () => {
    const input = await photo(800, 800);
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has EXIF
    const out = await toAvatarWebp(input);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.includes(Buffer.from("PhoneMaker"))).toBe(false);
  });

  test("accepts PNG and WebP input", async () => {
    for (const format of ["png", "webp"]) {
      const out = await toAvatarWebp(await photo(300, 400, format));
      expect((await sharp(out).metadata()).format).toBe("webp");
    }
  });

  test("rejects files that are not images, whatever they claim to be", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
    const truncated = (await photo(400, 400)).subarray(0, 200);
    for (const input of [html, svg, truncated, Buffer.alloc(0), Buffer.from("GIF89a")]) {
      await expect(toAvatarWebp(input)).rejects.toBeInstanceOf(UnsupportedImageError);
    }
  });

  test("rejects other image formats (GIF, TIFF)", async () => {
    for (const format of ["gif", "tiff"]) {
      await expect(toAvatarWebp(await photo(64, 64, format))).rejects.toBeInstanceOf(UnsupportedImageError);
    }
  });

  test("drops data appended after the image", async () => {
    const polyglot = Buffer.concat([await photo(400, 400), Buffer.from("<script>alert('polyglot')</script>")]);
    const out = await toAvatarWebp(polyglot);
    expect(out.includes(Buffer.from("polyglot"))).toBe(false);
  });
});

describe("error messages shown to users", () => {
  test("auth errors never echo the provider's text", () => {
    const leaky = { code: "unexpected_failure", message: "MongoServerError: E11000 duplicate key error collection: cpf.users" };
    expect(describeAuthError(leaky)).toBe(GENERIC_ERROR);
    expect(describeAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toMatch(/do not match/);
    expect(describeAuthError({ status: 429 })).toMatch(/Too many/);
  });

  test("the same message for a wrong password and an unknown account", () => {
    // The login service returns invalid_credentials for both; the wording must not add a distinction.
    expect(describeAuthError({ code: "invalid_credentials" })).not.toMatch(/exist|registered|unknown/i);
  });

  test("database errors map to fixed messages", () => {
    expect(describeDbError({ code: "P0001", message: "under_age" })).toMatch(/or older/);
    expect(describeDbError({ code: "42501", message: "not_authorized" })).toBe("You do not have permission to do that.");
    expect(describeDbError({ code: "XX000", message: "internal: connection string mongodb+srv://user:pw@…" })).toBe(GENERIC_ERROR);
    expect(describeDbError({ code: "23505", message: "dup" }, { 23505: "Taken." })).toBe("Taken.");
  });
});
