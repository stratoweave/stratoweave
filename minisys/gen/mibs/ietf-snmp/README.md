# IETF SNMP device MIBs

The `ietf_snmp` device type uses two standard MIB modules:

- `SNMPv2-MIB`, revision 200210160000Z: system identity, uptime, and SNMP
  statistics, from [RFC 3418](https://www.rfc-editor.org/rfc/rfc3418).
- `IF-MIB`, revision 200006140000Z: interface state and counters, including
  the 64-bit counters in ifXTable, from
  [RFC 2863](https://www.rfc-editor.org/rfc/rfc2863).
- `IANAifType-MIB`, revision 202208170000Z: the interface type definitions
  imported by IF-MIB, maintained by
  [IANA](https://www.iana.org/assignments/ianaiftype-mib/ianaiftype-mib).

These files are unmodified copies from the golden MIB corpus in
[actsnmp at bee0809999b6939f480887824f5d38558205cd61](https://github.com/stratoweave/actsnmp/tree/bee0809999b6939f480887824f5d38558205cd61/interop/mibs/golden).
The corpus manifest records their original sources and SHA-256 hashes.
Existing copyright notices remain in the files; see the referenced RFCs
and IANA registry for their legal notices. The SNMP package supplies the
base SMI modules and textual conventions.

The full MIBs are retained so generation can resolve their types, indexes,
and table augmentations. Polling reads only the subscribed objects.
