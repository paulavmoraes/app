import { describe, expect, it } from "vitest";
import { createDecipheriv, createECDH, hkdfSync, randomBytes, createPublicKey, verify } from "node:crypto";
import { buildPushPayload } from "@block65/webcrypto-web-push";

/** Acts as the browser: decrypts an aes128gcm web push body (RFC 8291). */
function decrypt(body: Buffer, client: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const serverPub = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  const secret = client.computeSecret(serverPub);
  const ikm = Buffer.from(hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), client.getPublicKey(), serverPub]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString(); // strip the 0x02 delimiter + padding
}

describe("web push payload", () => {
  it("is encrypted for the subscription and signed with our VAPID keys (as scripts/vapid.mjs generates them)", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
    const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;

    const client = createECDH("prime256v1");
    client.generateKeys();
    const auth = randomBytes(16);
    const message = { title: "Today's chores", body: "Dusting · Wash the sink (overdue by 2 days)", url: "/" };

    const req = await buildPushPayload(
      { data: message, options: { ttl: 3600 } },
      { endpoint: "https://push.example/send/abc", expirationTime: null, keys: { p256dh: client.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
      { subject: "https://chores.example", publicKey, privateKey },
    );

    const headers = new Headers(req.headers as HeadersInit);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(JSON.parse(decrypt(Buffer.from(req.body as Uint8Array), client, auth))).toEqual(message);

    const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.get("authorization")!)!;
    expect(m[2]).toBe(publicKey);
    const [h, p, sig] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://push.example", sub: "https://chores.example" });
    const key = createPublicKey({ key: await crypto.subtle.exportKey("jwk", pair.publicKey), format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});
