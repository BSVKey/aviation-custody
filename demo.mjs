#!/usr/bin/env node
// One fuel pump traced back to birth: manufacturer -> distributor -> airline (installed, later
// removed) -> repair station (overhaul, new release certificate) -> broker. A second airline
// considers buying it from the broker and checks the paperwork it was sent. Then a supplier
// is found to have used forged approvals, and every part it touched across a 500-part pool is
// found at once. All certificates here are sample files written by the demo.
//   node demo.mjs
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { genKeypair } from "./lib/keys.mjs";
import { signRecord, contentOf, registry } from "./lib/record.mjs";
import { part, append, fileFingerprint } from "./src/records.mjs";
import { verifyPart, checkCertificate, containment } from "./src/verify.mjs";

const D = 86400000, T0 = Date.parse("2019-03-04T00:00:00Z");
const day = (t) => new Date(t).toISOString().slice(0, 10);
const dir = mkdtempSync(join(tmpdir(), "aviation-demo-"));
const certFile = (name, text) => { writeFileSync(join(dir, name), text); return readFileSync(join(dir, name)); };

try {
  const orgs = [
    ["pump-maker", "manufacturer"], ["parts-distributor", "distributor"], ["airline-a", "operator"],
    ["repair-station", "repair-station"], ["parts-broker", "broker"], ["shady-supplier", "distributor"],
  ].map(([id, role]) => ({ id, role, kp: genKeypair() }));
  const k = Object.fromEntries(orgs.map((o) => [o.id, o.kp]));
  const SHADY_REVOKED = T0 + 1960 * D;
  const reg = registry(orgs.map((o) => ({ id: o.id, pub: o.kp.pub, role: o.role, validFrom: T0 - 3650 * D, ...(o.id === "shady-supplier" ? { revokedAt: SHADY_REVOKED } : {}) })));

  // Birth and life of one part.
  const birthCert = certFile("cert-birth.txt", "SAMPLE RELEASE CERTIFICATE\nPN FP-4420-01  SN FPX10417\nCondition: NEW\nIssued by pump-maker 2019-03-04\n");
  const overhaulCert = certFile("cert-overhaul.txt", "SAMPLE RELEASE CERTIFICATE\nPN FP-4420-01  SN FPX10417\nCondition: OVERHAULED\nIssued by repair-station 2024-06-20\n");
  const workOrder = certFile("wo-88213.txt", "SAMPLE WORK ORDER 88213: overhaul per component maintenance manual, bearings and seals replaced\n");
  const h = [part(k["pump-maker"], { pn: "FP-4420-01", sn: "FPX10417", manufacturer: "pump-maker", at: T0, certFp: fileFingerprint(birthCert) })];
  append(h, k["parts-distributor"], "handoff", { from: "pump-maker", to: "parts-distributor", at: T0 + 12 * D, certFp: fileFingerprint(birthCert) });
  append(h, k["airline-a"], "handoff", { from: "parts-distributor", to: "airline-a", at: T0 + 40 * D, certFp: fileFingerprint(birthCert) });
  append(h, k["repair-station"], "handoff", { from: "airline-a", to: "repair-station", at: T0 + 1900 * D, certFp: fileFingerprint(birthCert) });
  append(h, k["repair-station"], "work", { by: "repair-station", at: T0 + 1935 * D, work: "overhaul", workOrderFp: fileFingerprint(workOrder), certFp: fileFingerprint(overhaulCert) });
  append(h, k["parts-broker"], "handoff", { from: "repair-station", to: "parts-broker", at: T0 + 1950 * D, certFp: fileFingerprint(overhaulCert) });

  const v = verifyPart(h, { orgs: reg });
  console.log(`Part ${v.pn} serial ${v.sn}: ${h.length} signed records, back to birth`);
  for (const s of v.trace) console.log(`  ${day(s.at)}  ${s.kind.padEnd(8)} ${s.org.padEnd(18)} ${s.work ?? ""}`);
  console.log(`History verified against the organization key registry: ${v.ok ? "PASS" : "FAIL " + JSON.stringify(v.problems)}`);
  console.log(`Current holder: ${v.holder}\n`);

  console.log("The buyer checks the certificate the broker sent:");
  const show = (label, bytes) => console.log(`  ${label.padEnd(46)} ${checkCertificate(h, bytes, { orgs: reg }).verdict}`);
  show("overhaul certificate, as issued", overhaulCert);
  show("original birth certificate", birthCert);
  show("overhaul certificate with the date edited", Buffer.from(overhaulCert.toString().replace("2024-06-20", "2025-06-20")));
  show("a certificate copied from another serial", Buffer.from(overhaulCert.toString().replace("FPX10417", "FPX10418")));

  console.log("\nTampering with the history:");
  const attempt = (label, mutate) => {
    const q = structuredClone(h);
    mutate(q);
    const r = verifyPart(q, { orgs: reg });
    console.log(`  ${label.padEnd(60)} ${r.ok ? "NOT CAUGHT" : "caught: " + [...new Set(r.problems.map((x) => x.reason))].join(", ")}`);
  };
  const forgedShop = genKeypair();
  attempt("broker adds an overhaul signed by an unregistered shop", (q) => append(q, forgedShop, "work", { by: "repair-station", at: T0 + 2000 * D, work: "overhaul", workOrderFp: "0x00", certFp: "0x11" }));
  attempt("broker signs an overhaul itself", (q) => append(q, k["parts-broker"], "work", { by: "parts-broker", at: T0 + 2000 * D, work: "overhaul", workOrderFp: "0x00", certFp: "0x11" }));
  attempt("repair record rewritten to say inspection, not overhaul", (q) => { q[4] = signRecord(k["repair-station"], { ...contentOf(q[4]), work: "inspection" }); });
  attempt("airline-a's years of service removed from the history", (q) => { q.splice(2, 2); });
  attempt("broker receives it with a different certificate", (q) => { q[5] = signRecord(k["parts-broker"], { ...contentOf(q[5]), certFp: fileFingerprint(birthCert) }); });
  attempt("shady supplier signs a handoff after its key was revoked", (q) => append(q, k["shady-supplier"], "handoff", { from: "parts-broker", to: "shady-supplier", at: SHADY_REVOKED + 10 * D, certFp: fileFingerprint(overhaulCert) }));

  // Containment across a pool of 500 parts, some of which passed through the shady supplier.
  const pool = [];
  for (let i = 0; i < 500; i++) {
    const t = T0 + (i % 900) * D, c = `0x${String(i).padStart(64, "0")}`;
    const ph = [part(k["pump-maker"], { pn: i % 2 ? "FP-4420-01" : "VLV-210-07", sn: `S${100000 + i}`, manufacturer: "pump-maker", at: t, certFp: c })];
    const via = i % 7 === 0 ? "shady-supplier" : "parts-distributor";
    append(ph, k[via], "handoff", { from: "pump-maker", to: via, at: t + 5 * D, certFp: c });
    append(ph, k["airline-a"], "handoff", { from: via, to: "airline-a", at: t + 30 * D, certFp: c });
    pool.push(ph);
  }
  const all = pool.every((ph) => verifyPart(ph, { orgs: reg }).ok);
  const hits = containment(pool, "shady-supplier");
  console.log(`\nContainment: ${pool.length} parts in the pool, all histories verify: ${all}`);
  console.log(`  parts that passed through shady-supplier: ${hits.length}, found in one query (first: ${hits[0].pn} ${hits[0].sn}, ${day(hits[0].firstAt)})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
