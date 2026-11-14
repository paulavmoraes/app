// Prints a new VAPID key pair for web push. Run once per deployment: `npm run vapid`.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await crypto.subtle.exportKey("raw", publicKey)).toString("base64url");
const { d } = await crypto.subtle.exportKey("jwk", privateKey);
console.log(`VAPID_PUBLIC_KEY=${raw}\nVAPID_PRIVATE_KEY=${d}`);
