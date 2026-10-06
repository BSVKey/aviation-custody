# Aviation Custody

Verifiable history for aircraft parts, back to birth.

Aircraft parts move between manufacturers, distributors, repair stations, operators and
brokers, each step backed by a release certificate. Here every organization signs what it
did with the part: the manufacturer at birth, each receiver at each handoff, each repair
station for the work it performed. Certificates are never stored, only fingerprinted, so
a buyer can check that the certificate it was handed is the genuine, current one before
paying for the part.

```
npm test          # offline, zero dependencies
node demo.mjs     # one fuel pump: manufacturer -> distributor -> airline -> repair station -> broker
```

## What the demo shows

```
Part FP-4420-01 serial FPX10417: 6 signed records, back to birth
  2019-03-04  part     pump-maker
  2019-03-16  handoff  parts-distributor
  2019-04-13  handoff  airline-a
  2024-05-16  handoff  repair-station
  2024-06-20  work     repair-station     overhaul
  2024-07-05  handoff  parts-broker
History verified against the organization key registry: PASS

The buyer checks the certificate the broker sent:
  overhaul certificate, as issued                genuine and current
  original birth certificate                     genuine but superseded
  overhaul certificate with the date edited      not genuine
  a certificate copied from another serial       not genuine

Tampering with the history:
  broker adds an overhaul signed by an unregistered shop       caught
  broker signs an overhaul itself                              caught
  repair record rewritten to say inspection, not overhaul      caught
  airline-a's years of service removed from the history        caught
  broker receives it with a different certificate              caught
  shady supplier signs a handoff after its key was revoked     caught

Containment: 500 parts in the pool, all histories verify: true
  parts that passed through shady-supplier: 72, found in one query
```

All part numbers, serials, organizations and certificates in the demo are sample data.

## Records

| Record | Signed by | Says |
|---|---|---|
| `aviation.part/1` | the manufacturer | part number, serial, and a fingerprint of the original release certificate; its id is the part's identity for life |
| `aviation.handoff/1` | the receiving organization | received this part from that organization, with the certificate whose fingerprint is this; names the previous record |
| `aviation.work/1` | the repair station holding the part | the work performed, fingerprints of the work order and of the new release certificate; names the previous record |

A certificate's fingerprint is the SHA-256 of its exact file bytes, so an edited, copied
or re-scanned document does not match. All records use canonical JSON, a SHA-256 content
id and an Ed25519 signature.

## Rules the verifier applies

- Every record verifies and is signed by a key registered to the organization it names,
  valid at the record's time. Keys come from the verifier's registry, never from the
  records; a revoked key is refused for records signed after revocation.
- Only a manufacturer can sign a birth record, and only a repair station can sign work.
- The history is one unbroken chain for one part, in time order.
- A handoff must come from the organization holding the part and carry its current
  certificate. Work must be done by the holder and must issue a new certificate.
- `checkCertificate` answers the buyer's question: genuine and current, genuine but
  superseded, or not genuine.
- `containment` lists every part an organization signed for, optionally within a time
  range.

## Scope

Civil aviation only. This is evidence tooling, not an approved data system, and does not
replace regulator or operator approval processes or the certificates themselves.

## License

Apache License 2.0. Copyright 2026 Embryo Space Inc. (DBA BSVKey).
