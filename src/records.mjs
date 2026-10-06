// Signed records for an aircraft part's history, back to birth.
//
//   aviation.part/1     signed by the MANUFACTURER at birth: part number, serial, and a
//                       fingerprint of the original release certificate. Its claimId is the
//                       part's identity for the rest of its life.
//   aviation.handoff/1  signed by the RECEIVING organization: "I received this part from that
//                       organization, with the certificate whose fingerprint is this".
//   aviation.work/1     signed by the repair station holding the part: the work performed, a
//                       fingerprint of the work order and of the new release certificate.
//
// Every record after birth names the part and the record before it, so the history is one
// chain. Certificates are never stored, only fingerprinted: SHA-256 of the exact file bytes,
// so a copied, edited or re-scanned certificate does not match.
import { createHash } from "node:crypto";
import { signRecord } from "../lib/record.mjs";

export const fileFingerprint = (bytes) => "0x" + createHash("sha256").update(bytes).digest("hex");

export const part = (kp, { pn, sn, manufacturer, at, certFp }) =>
  signRecord(kp, { kind: "aviation.part/1", pn, sn, manufacturer, at, certFp });

export const handoff = (kp, { partId, from, to, at, certFp, prev }) =>
  signRecord(kp, { kind: "aviation.handoff/1", partId, from, to, at, certFp, prev });

export const work = (kp, { partId, by, at, work: performed, workOrderFp, certFp, prev }) =>
  signRecord(kp, { kind: "aviation.work/1", partId, by, at, work: performed, workOrderFp, certFp, prev });

// Append the next record to a history, filling in partId and prev.
export function append(history, kp, kind, fields) {
  const last = history.at(-1);
  const base = { partId: history[0].claimId, prev: last.claimId, ...fields };
  history.push(kind === "handoff" ? handoff(kp, base) : work(kp, base));
  return history;
}
