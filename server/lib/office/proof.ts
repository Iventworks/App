import { createPublicKey, type KeyObject, verify } from "node:crypto";
import type { OfficeDiscovery } from "./discovery";

/**
 * WOPI proof keys (MS-WOPI "proof keys"): the office server signs every call with its private key;
 * the public key comes with the discovery. Signed are the access token, the full request URL in
 * upper case and the time (`X-WOPI-TimeStamp`, .NET ticks), each with a length prefix. A call is
 * genuine when `X-WOPI-Proof` matches the current key, `X-WOPI-ProofOld` matches the current key
 * or `X-WOPI-Proof` matches the old key (key rotation) — and it is at most 20 minutes old.
 */
export namespace WopiProof {
	export const MAX_AGE_MS = 20 * 60 * 1000;
	/** Ticks (100 ns) between 0001-01-01 and 1970-01-01. */
	const EPOCH_TICKS = 621_355_968_000_000_000n;

	export function ticksToMs(ticks: bigint) {
		return Number((ticks - EPOCH_TICKS) / 10_000n);
	}

	export function msToTicks(ms: number) {
		return BigInt(ms) * 10_000n + EPOCH_TICKS;
	}

	function lengthPrefixed(data: Buffer) {
		const length = Buffer.alloc(4);
		length.writeInt32BE(data.length);
		return Buffer.concat([length, data]);
	}

	/** The bytes the office server signs. */
	export function expected(accessToken: string, url: string, timestamp: bigint) {
		const time = Buffer.alloc(8);
		time.writeBigInt64BE(timestamp);
		return Buffer.concat([
			lengthPrefixed(Buffer.from(accessToken, "utf8")),
			lengthPrefixed(Buffer.from(url.toUpperCase(), "utf8")),
			lengthPrefixed(time),
		]);
	}

	const base64url = (base64: string) => Buffer.from(base64, "base64").toString("base64url");

	/** Key objects of the keys seen so far (the office server has one or two at a time). */
	const keys = new Map<string, KeyObject>();

	export function keyFrom(key: OfficeDiscovery.ProofKey): KeyObject {
		const id = `${key.modulus}.${key.exponent}`;
		let object = keys.get(id);
		if (!object) {
			object = createPublicKey({
				key: { kty: "RSA", n: base64url(key.modulus), e: base64url(key.exponent) },
				format: "jwk",
			});
			// New keys after an update: the old ones aren't needed for long.
			if (keys.size >= 8) keys.clear();
			keys.set(id, object);
		}
		return object;
	}

	function matches(data: Buffer, signature: string | undefined, key: KeyObject | null) {
		if (!signature || !key) return false;
		try {
			return verify("RSA-SHA256", data, key, Buffer.from(signature, "base64"));
		} catch {
			return false;
		}
	}

	/** Whether a WOPI call carries a valid, fresh proof. */
	export function check(input: {
		accessToken: string;
		url: string;
		timestamp: string | undefined;
		proof: string | undefined;
		proofOld: string | undefined;
		current: OfficeDiscovery.ProofKey;
		old: OfficeDiscovery.ProofKey | null;
		now?: number;
	}) {
		if (!input.timestamp || !/^\d{1,20}$/.test(input.timestamp)) return false;
		const timestamp = BigInt(input.timestamp);
		const age = (input.now ?? Date.now()) - ticksToMs(timestamp);
		if (age > MAX_AGE_MS || age < -MAX_AGE_MS) return false;

		const data = expected(input.accessToken, input.url, timestamp);
		const current = keyFrom(input.current);
		const old = input.old ? keyFrom(input.old) : null;
		return (
			matches(data, input.proof, current) ||
			matches(data, input.proofOld, current) ||
			matches(data, input.proof, old)
		);
	}
}
