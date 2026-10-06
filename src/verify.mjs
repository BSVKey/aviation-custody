// Verify a part's history back to birth against a registry of organization keys, and check
// the paperwork a seller hands over against that history.
//
// history: [aviation.part/1, then aviation.handoff/1 | aviation.work/1 ...] in order
// orgs:    registry() of organizations: { id, pub, role, validFrom?, revokedAt? }
//          roles: manufacturer, distributor, repair-station, operator, broker
//
// Checks: every record intact and signed by a key registered to the organization it names,
// valid at the record's time; one part identity and one unbroken chain; each handoff comes
// from the organization holding the part and carries its current certificate; work is done
// only by the holder, only by an approved repair station, and issues a new certificate.
import { verifyRecord } from "../lib/record.mjs";
import { fileFingerprint } from "./records.mjs";

const ROLE_FOR = { "aviation.part/1": ["manufacturer"], "aviation.work/1": ["repair-station"] };

export function verifyPart(history, { orgs }) {
  const problems = [];
  const bad = (reason, detail = {}) => problems.push({ reason, ...detail });
  const trace = [];
  if (!Array.isArray(history) || !history.length) return { ok: false, problems: [{ reason: "empty_history" }], trace };

  const birth = history[0];
  if (birth.kind !== "aviation.part/1") bad("history_does_not_start_at_birth");
  let holder = birth.manufacturer, cert = birth.certFp, prev = null;
  history.forEach((r, i) => {
    const v = verifyRecord(r);
    if (!v.ok) { bad(v.reason, { index: i, kind: r?.kind }); return; }
    const org = r.kind === "aviation.part/1" ? r.manufacturer : r.kind === "aviation.handoff/1" ? r.to : r.by;
    const keyProblem = orgs.check(org, v.signer, r.at);
    if (keyProblem) bad(keyProblem, { index: i, org });
    const role = orgs.attrs(org)?.role;
    if (ROLE_FOR[r.kind] && !ROLE_FOR[r.kind].includes(role)) bad("organization_not_approved_for_record", { index: i, org, role, kind: r.kind });

    if (i > 0) {
      if (r.partId !== birth.claimId) bad("wrong_part", { index: i });
      if (r.prev !== prev.claimId) bad("history_chain_break", { index: i });
      if (r.at < prev.at) bad("time_regression", { index: i });
    }
    if (r.kind === "aviation.handoff/1") {
      if (r.from !== holder) bad("handoff_from_non_holder", { index: i, from: r.from, holder });
      if (r.certFp !== cert) bad("certificate_does_not_match_history", { index: i, org });
      holder = r.to;
    } else if (r.kind === "aviation.work/1") {
      if (r.by !== holder) bad("work_by_non_holder", { index: i, by: r.by, holder });
      if (!r.certFp || r.certFp === cert) bad("work_without_new_certificate", { index: i });
      cert = r.certFp;
    }
    trace.push({ at: r.at, kind: r.kind.split(".")[1].split("/")[0], org, work: r.work, holder, certFp: cert });
    prev = r;
  });
  return { ok: problems.length === 0, problems, pn: birth.pn, sn: birth.sn, partId: birth.claimId, holder, currentCertFp: cert, trace };
}

// The buyer's question: is this certificate file the genuine, current one for this part?
//   genuine  the file's fingerprint appears in the verified history
//   current  it is the latest certificate (an older one has been superseded by later work)
export function checkCertificate(history, fileBytes, { orgs }) {
  return checkCertificateFingerprint(history, fileFingerprint(fileBytes), { orgs });
}

// The same check from a fingerprint computed where the file is (the file itself need not move).
export function checkCertificateFingerprint(history, fp, { orgs }) {
  const v = verifyPart(history, { orgs });
  const issued = history.filter((r) => r.kind !== "aviation.handoff/1").map((r) => r.certFp);
  const genuine = v.ok && issued.includes(fp);
  return { historyOk: v.ok, genuine, current: genuine && fp === v.currentCertFp, fingerprint: fp, verdict: !v.ok ? "history does not verify" : !genuine ? "not genuine" : fp === v.currentCertFp ? "genuine and current" : "genuine but superseded" };
}

// Containment: every part whose history a given organization signed, optionally only records
// signed in a time range (for example, after its approval was found to be forged).
export function containment(histories, org, { from = -Infinity, to = Infinity } = {}) {
  const hits = [];
  for (const h of histories) {
    const touched = h.filter((r) => [r.manufacturer, r.to, r.by].includes(org) && r.at >= from && r.at <= to);
    if (touched.length) hits.push({ pn: h[0].pn, sn: h[0].sn, partId: h[0].claimId, records: touched.length, firstAt: touched[0].at });
  }
  return hits;
}
