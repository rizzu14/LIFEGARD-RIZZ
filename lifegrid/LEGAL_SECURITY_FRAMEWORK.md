# LIFEGRID – Legal & Security Framework
## National Emergency Coordination Infrastructure

---

## Legal Architecture

### 1. Good Samaritan Law Integration

#### Jurisdictions Covered

| Jurisdiction | Legal Basis | Protection Scope |
|-------------|-------------|-----------------|
| United States | 42 U.S.C. § 1983; State Good Samaritan statutes | Civil liability immunity for good-faith reporters |
| European Union | GDPR Art. 6(1)(d) vital interests; Art. 9(2)(c) | Civil and criminal immunity for emergency assistance |
| India | Motor Vehicles Act 1988 §134A; SC Guidelines 2016 | Protection from civil/criminal liability |
| International | ICCPR Art. 6; UDHR Art. 3 | Good-faith emergency reporting protection |

#### Implementation

Every emergency report automatically receives a **Good Samaritan Token** — a cryptographically signed record that:

1. Documents the legal basis for data collection (vital interests exception)
2. Establishes the reporter's good-faith status
3. Provides immunity certificate for responders
4. Cannot be reversed to reveal reporter identity (one-way HMAC hash)

```
GoodSamaritanToken {
  tokenId:       UUID (unique per report)
  incidentId:    UUID
  jurisdiction:  "US" | "EU" | "IN" | "DEFAULT"
  legalBasis:    "GDPR Art. 6(1)(d) vital interests..."
  immunityScope: "Civil liability immunity..."
  reporterHash:  HMAC-SHA256(reporterIdentifier, TOKEN_SECRET)
  signature:     HMAC-SHA256(tokenId:incidentId:issuedAt:reporterHash)
  issuedAt:      ISO8601
  expiresAt:     ISO8601 (per jurisdiction retention schedule)
}
```

#### False Report Deterrence

- Disclosure shown before every report submission
- Penalty information per jurisdiction displayed
- Reports linked to device fingerprint (not identity) for pattern detection
- More than 5 reports/hour from same reporter triggers review flag
- False report pattern detection via `ThreatDetection.detectFalseReportPattern()`

#### Anonymous Reporting

All jurisdictions allow anonymous reporting. The system:
- Does not require account creation for SOS
- Stores only a pseudonymized device hash (not the device ID)
- Location is stored but access-controlled by role
- Caller phone number is masked in operator view (last 4 digits only)

---

### 2. Data Privacy Compliance

#### Frameworks Implemented

| Framework | Scope | Key Requirements |
|-----------|-------|-----------------|
| GDPR | EU/EEA | Consent, erasure, portability, 72h breach notification |
| CCPA | California | Right to know, delete, opt-out of sale |
| HIPAA | US health data | Minimum necessary, PHI protection, BAA |
| PDPA | India/Thailand | Consent, purpose limitation, cross-border transfer |
| PIPEDA | Canada | Accountability, consent, accuracy |

#### Data Classification

```
PUBLIC       → No restrictions (system status, public alerts)
INTERNAL     → Staff only (operational metrics)
CONFIDENTIAL → Need-to-know (incident details, responder info)
RESTRICTED   → Encrypted + audit-logged (PII, location, communications)
TOP_SECRET   → Encrypted + MFA required + full audit (biometrics, health, national ID)
```

#### PII Field Registry

| Field | Category | Classification | Masking | Encrypted at Rest |
|-------|----------|---------------|---------|------------------|
| phone | IDENTITY | RESTRICTED | PSEUDONYMIZE | ✓ |
| email | IDENTITY | RESTRICTED | PSEUDONYMIZE | ✓ |
| name | IDENTITY | CONFIDENTIAL | PSEUDONYMIZE | ✓ |
| location | LOCATION | RESTRICTED | TOKENIZE | ✓ |
| faceEmbedding | BIOMETRIC | TOP_SECRET | HASH | ✓ |
| medicalInfo | HEALTH | TOP_SECRET | REDACT | ✓ |
| nationalId | GOVERNMENT_ID | TOP_SECRET | TOKENIZE | ✓ |
| ipAddress | BEHAVIORAL | CONFIDENTIAL | PSEUDONYMIZE | ✗ |
| rawInput | COMMUNICATION | RESTRICTED | NONE | ✓ |

#### Data Retention Schedule

| Category | Retention | Legal Basis | Auto-Delete |
|----------|-----------|-------------|-------------|
| Location | 90 days | Emergency response necessity | ✓ |
| Identity | 7 years | Legal obligation | ✗ |
| Health | 7 years | HIPAA minimum necessary | ✗ |
| Biometric | 30 days | Explicit consent / vital interest | ✓ |
| Behavioral | 1 year | Legitimate interest | ✓ |
| Communication | 5 years | Legal obligation | ✗ |
| Sensor data | 1 year | Operational necessity | ✓ |
| Satellite | 5 years | Scientific research exception | ✗ |

#### Citizen Rights Implementation

**Right to Erasure (GDPR Art. 17)**
```
POST /api/v1/privacy/erasure-request
→ Pseudonymizes: email, phone, name
→ Deletes: location history, behavioral data
→ Retains: incident records (legal obligation), audit log (immutable)
→ Returns: list of erased vs retained fields with reason
```

**Right to Portability (GDPR Art. 20)**
```
GET /api/v1/privacy/export
→ Returns: JSON export of all personal data
→ Format: LIFEGRID-GDPR-EXPORT-v1
→ Includes: incidents, consent records, retention policy
```

**Breach Notification (GDPR Art. 33)**
```
→ 72-hour notification to supervisory authority
→ Breach register maintained in breach_register table
→ Affected users notified within 72 hours
→ Severity classification: HIGH (>1000 records), MEDIUM (<1000)
```

---

### 3. Citizen Protection Policies

#### Anonymous Emergency Reporting
- No account required for SOS
- Device ID pseudonymized before storage
- Location stored only for active incident duration
- Caller phone masked in all operator views

#### Vulnerable Population Protections
- Children (age < 18): enhanced data protection, parental notification
- Elderly (age > 70): priority dispatch scoring
- Domestic violence: witness protection mode available
- Witness protection: complete identity suppression, protected ID issued

#### Data Minimization
- Only fields necessary for emergency response are collected
- Medical details collected only when incident type is MEDICAL
- Biometric data (face embeddings) stored maximum 30 days
- Location precision reduced for ANALYST role (city-level only)

---

## Security Architecture

### Security Layers

```
Layer 1: NETWORK
  TLS 1.3 (all external traffic)
  HSTS with preload (max-age: 31536000)
  Certificate pinning (mobile apps)
  DDoS protection (Cloudflare / AWS Shield)

Layer 2: PERIMETER
  Nginx reverse proxy (rate limiting, header stripping)
  IP blocking (dynamic, threat-score based)
  Geo-blocking (configurable per jurisdiction)
  Bot detection (user agent + behavior analysis)

Layer 3: APPLICATION
  JWT RS256 (15-min access, 7-day refresh with rotation)
  MFA (TOTP) for OPERATOR+ roles
  Account lockout (5 failures → 15-min lockout)
  Request signing (HMAC-SHA256, optional for browser clients)
  Replay attack prevention (nonce + 5-min window)
  CSRF protection (double-submit cookie)
  Input sanitization (SQL injection, XSS, path traversal)
  Content Security Policy (strict)

Layer 4: DATA
  AES-256-GCM (field-level encryption for PII)
  HKDF key derivation (per-channel dispatch keys)
  Column encryption (PostgreSQL pgcrypto)
  Pseudonymization (HMAC-SHA256 with rotation key)
  Tokenization (reversible with key escrow)

Layer 5: AUDIT
  Immutable audit log (PostgreSQL, delete trigger)
  Kafka audit topic (365-day retention)
  All access logged with actor ID, role, IP, timestamp
  Tamper-evident (HMAC chain on audit records)
```

### End-to-End Encryption

```
Citizen Device → API Gateway:
  TLS 1.3 (transport)
  JWT Bearer token (authentication)

API Gateway → Dispatch Service:
  Internal mTLS (production)
  Service-to-service JWT

Dispatch Service → Responder Device:
  AES-256-GCM encrypted channel
  HKDF-derived key per incident+responder pair
  Key: HKDF(sessionKey, salt, "lifegrid:dispatch:{incidentId}:{responderId}:{channelId}")

Responder Device → API Gateway:
  TLS 1.3 + JWT Bearer

Satellite Messages:
  HMAC-SHA256 authentication
  Compact binary format (340-byte SBD)
  Provider-level encryption (Iridium/Starlink)

Database at Rest:
  PostgreSQL: pgcrypto for PII columns
  Redis: encrypted at OS level (LUKS)
  Kafka: broker-level encryption
  Backups: AES-256 encrypted
```

### Identity Masking by Role

```
CITIZEN:    Own data visible in full; others' data not accessible
OPERATOR:   Phone last-4 only; email masked; location exact; name visible
SUPERVISOR: Full access to operational data; audit-logged
COMMANDER:  Full access; all actions audit-logged
RESPONDER:  Citizen phone (for contact); location exact; no email
ANALYST:    No PII; city-level location only; pseudonymized IDs
SYSTEM_ADMIN: Full access; MFA required; all actions audit-logged
```

### Secure API Gateway Controls

| Control | Implementation | Threshold |
|---------|---------------|-----------|
| Rate limiting | Redis sliding window | 500 req/15min global |
| Emergency endpoint limit | Redis | 30 req/min |
| IoT endpoint limit | Redis | 500 req/sec |
| Request body size | Express limit | 10MB |
| URL length | Middleware check | 2048 chars |
| Header count | Middleware check | 50 headers |
| Replay window | Redis nonce | 5 minutes |
| Brute force lockout | Redis counter | 5 failures → 15min |

---

## Risk Mitigation Plan

### Risk Register

| Risk | Likelihood | Impact | Mitigation | Residual Risk |
|------|-----------|--------|-----------|---------------|
| Mass data breach | LOW | CRITICAL | AES-256-GCM + field encryption + breach detection | LOW |
| False emergency reports | MEDIUM | HIGH | Pattern detection + Good Samaritan disclosure + rate limiting | LOW |
| Insider threat | LOW | HIGH | RBAC + audit log + anomaly detection + MFA | LOW |
| DDoS attack | HIGH | HIGH | Rate limiting + IP blocking + CDN + redundancy | MEDIUM |
| JWT token theft | LOW | HIGH | 15-min expiry + rotation + blacklist + MFA | LOW |
| SQL injection | LOW | CRITICAL | Parameterized queries + input sanitization + WAF | VERY LOW |
| XSS attack | LOW | MEDIUM | CSP headers + input sanitization + output encoding | VERY LOW |
| Satellite message spoofing | LOW | HIGH | HMAC-SHA256 authentication + provider encryption | LOW |
| Replay attacks | LOW | MEDIUM | Nonce + timestamp window + Redis deduplication | VERY LOW |
| Key compromise | VERY LOW | CRITICAL | Key rotation + HSM (production) + key escrow | LOW |
| GDPR violation | LOW | HIGH | Privacy compliance engine + consent records + erasure | LOW |
| Witness identity exposure | VERY LOW | CRITICAL | Witness protection mode + one-way hashing | VERY LOW |

### Incident Response Plan

```
SEVERITY 1 (CRITICAL — active breach):
  T+0:    Detect via security event monitoring
  T+5m:   Isolate affected systems
  T+15m:  Notify security team + management
  T+1h:   Assess scope, begin forensics
  T+24h:  Notify DPA (GDPR 72h clock starts)
  T+48h:  Notify affected users
  T+72h:  DPA notification deadline

SEVERITY 2 (HIGH — suspected breach):
  T+0:    Detect via anomaly detection
  T+30m:  Investigate and assess
  T+2h:   Escalate if confirmed
  T+24h:  Document in breach register

SEVERITY 3 (MEDIUM — security event):
  T+0:    Log in security_events table
  T+4h:   Review and classify
  T+24h:  Remediate if needed
```

### Key Rotation Schedule

| Key Type | Rotation Period | Method | Downtime |
|----------|----------------|--------|---------|
| JWT signing (RS256) | 90 days | Rolling (overlap period) | Zero |
| AES-256-GCM master | 180 days | Key wrapping | Zero |
| API signing key | 365 days | Versioned | Zero |
| Dispatch channels | Per incident | Ephemeral | N/A |
| Pseudonymization key | 365 days | Re-pseudonymize all records | Maintenance window |

### Penetration Testing Schedule

| Test Type | Frequency | Scope |
|-----------|-----------|-------|
| External pentest | Quarterly | All public endpoints |
| Internal pentest | Semi-annual | All internal services |
| Red team exercise | Annual | Full system |
| Dependency audit | Monthly | npm audit, pip-audit |
| SAST (static analysis) | Every commit | CI/CD pipeline |
| DAST (dynamic analysis) | Weekly | Staging environment |
| Social engineering | Annual | Staff awareness |

---

## Compliance Checklist

### GDPR
- [x] Lawful basis documented (vital interests Art. 6(1)(d))
- [x] Data minimization enforced (PII field registry)
- [x] Retention schedules implemented (auto-delete functions)
- [x] Right to erasure endpoint (`POST /privacy/erasure-request`)
- [x] Right to portability endpoint (`GET /privacy/export`)
- [x] Breach notification procedure (72h, breach_register table)
- [x] Privacy by design (pseudonymization, masking by default)
- [x] DPO contact configured (`process.env.DPA_NOTIFICATION_EMAIL`)
- [x] Consent records table with withdrawal support
- [x] Row-level security policies on sensitive tables

### HIPAA (when handling medical data)
- [x] Minimum necessary standard (MEDICAL incidents only)
- [x] PHI encrypted at rest (AES-256-GCM)
- [x] PHI encrypted in transit (TLS 1.3)
- [x] Access controls (RBAC + audit log)
- [x] Audit controls (immutable audit_log table)
- [x] Integrity controls (HMAC signatures)
- [x] Transmission security (TLS + JWT)
- [ ] BAA with cloud providers (required in production)

### Good Samaritan
- [x] Jurisdiction detection (x-jurisdiction header)
- [x] Legal basis documented per jurisdiction
- [x] Immunity tokens issued per report
- [x] False report disclosure shown
- [x] Anonymous reporting supported
- [x] Mandatory reporter categories defined
- [x] Responder immunity certificates generated

---

## Security Contact

```
Security Team:     security@lifegrid.gov
Bug Bounty:        https://lifegrid.gov/security/bug-bounty
DPA Contact:       dpa@lifegrid.gov
Incident Hotline:  +1-800-LIFEGRID-SEC
PGP Key:           https://lifegrid.gov/.well-known/security.txt
```
