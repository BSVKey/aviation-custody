import test from "node:test";
import assert from "node:assert/strict";
import { genKeypair } from "../lib/keys.mjs";
import { signRecord, contentOf, registry } from "../lib/record.mjs";
import { part, append, fileFingerprint } from "../src/records.mjs";
import { verifyPart, checkCertificate, checkCertificateFingerprint, containment } from "../src/verify.mjs";

const D = 86400000, T0 = Date.parse("2020-01-01T00:00:00Z");
const certA = Buffer.from("sample certificate A"), certB = Buffer.from("sample certificate B");

function setup({ revokeShopAt } = {}) {
  const ids = { maker: "manufacturer", dist: "distributor", shop: "repair-station", op: "operator" };
  const k = Object.fromEntries(Object.keys(ids).map((id) => [id, genKeypair()]));
  const orgs = registry(Object.entries(ids).map(([id, role]) => ({ id, role, pub: k[id].pub, ...(id === "shop" && revokeShopAt ? { revokedAt: revokeShopAt } : {}) })));
  const h = [part(k.maker, { pn: "P1", sn: "S1", manufacturer: "maker", at: T0, certFp: fileFingerprint(certA) })];
  append(h, k.dist, "handoff", { from: "maker", to: "dist", at: T0 + D, certFp: fileFingerprint(certA) });
  append(h, k.shop, "handoff", { from: "dist", to: "shop", at: T0 + 2 * D, certFp: fileFingerprint(certA) });
  append(h, k.shop, "work", { by: "shop", at: T0 + 3 * D, work: "repair", workOrderFp: "0xaa", certFp: fileFingerprint(certB) });
  append(h, k.op, "handoff", { from: "shop", to: "op", at: T0 + 4 * D, certFp: fileFingerprint(certB) });
  return { k, orgs, h };
}

test("a history back to birth verifies and ends with the right holder and certificate", () => {
  const { orgs, h } = setup();
  const v = verifyPart(h, { orgs });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.equal(v.holder, "op");
  assert.equal(v.currentCertFp, fileFingerprint(certB));
  assert.deepEqual(v.trace.map((s) => s.kind), ["part", "handoff", "handoff", "work", "handoff"]);
});

test("certificate check: current, superseded, edited", () => {
  const { orgs, h } = setup();
  assert.equal(checkCertificate(h, certB, { orgs }).verdict, "genuine and current");
  assert.equal(checkCertificate(h, certA, { orgs }).verdict, "genuine but superseded");
  assert.equal(checkCertificate(h, Buffer.from("sample certificate B "), { orgs }).verdict, "not genuine");
});

test("wrong signer, wrong role, wrong holder, swapped certificate, removed record", () => {
  const { k, orgs, h } = setup();
  const run = (mutate) => { const q = structuredClone(h); mutate(q); return verifyPart(q, { orgs }).problems.map((p) => p.reason); };
  assert.ok(run((q) => append(q, genKeypair(), "handoff", { from: "op", to: "dist", at: T0 + 5 * D, certFp: fileFingerprint(certB) })).includes("signer_not_registered_key"));
  assert.ok(run((q) => append(q, k.dist, "work", { by: "dist", at: T0 + 5 * D, work: "repair", workOrderFp: "0x1", certFp: "0x2" })).includes("organization_not_approved_for_record"));
  assert.ok(run((q) => append(q, k.dist, "handoff", { from: "maker", to: "dist", at: T0 + 5 * D, certFp: fileFingerprint(certB) })).includes("handoff_from_non_holder"));
  assert.ok(run((q) => { q[4] = signRecord(k.op, { ...contentOf(q[4]), certFp: fileFingerprint(certA) }); }).includes("certificate_does_not_match_history"));
  assert.ok(run((q) => q.splice(1, 1)).includes("history_chain_break"));
  assert.ok(run((q) => { q[2].at = 0; }).includes("claimId_mismatch"));
});

test("a revoked key is refused for records signed after revocation only", () => {
  const before = setup({ revokeShopAt: T0 + 10 * D });
  assert.equal(verifyPart(before.h, { orgs: before.orgs }).ok, true);
  const after = setup({ revokeShopAt: T0 + 2.5 * D });
  assert.deepEqual(verifyPart(after.h, { orgs: after.orgs }).problems.map((p) => p.reason), ["key_revoked"]);
});

test("containment finds every part an organization touched, within a time range", () => {
  const { orgs, h } = setup();
  const other = setup().h;
  assert.equal(containment([h, other], "shop").length, 2);
  assert.equal(containment([h], "shop", { from: T0 + 3.5 * D }).length, 0);
  assert.equal(verifyPart(h, { orgs }).ok, true);
});

test("certificate check from a fingerprint alone", () => {
  const { orgs, h } = setup();
  assert.equal(checkCertificateFingerprint(h, fileFingerprint(certB), { orgs }).verdict, "genuine and current");
  assert.equal(checkCertificateFingerprint(h, "0x" + "00".repeat(32), { orgs }).verdict, "not genuine");
});
