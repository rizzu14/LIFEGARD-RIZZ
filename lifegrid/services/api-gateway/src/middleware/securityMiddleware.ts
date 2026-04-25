// ============================================================
// LIFEGRID – Unified Security Middleware Stack
// Composes all security layers in correct order
// ============================================================

import { Router } from 'express';
import { SecureAPIGateway } from '../security/SecureAPIGateway';
import { ThreatDetection } from '../security/ThreatDetection';
import { PrivacyCompliance } from '../legal/PrivacyCompliance';
import { GoodSamaritanPolicy } from '../legal/GoodSamaritanPolicy';
import { IdentityMasking } from '../security/IdentityMasking';

/**
 * Apply the full security middleware stack to a router.
 *
 * Order matters:
 *   1. HTTPS enforcement (redirect before any processing)
 *   2. Security headers (set before any response)
 *   3. IP blocking (fast reject)
 *   4. Threat detection (anomaly scoring)
 *   5. Request limits (prevent DoS)
 *   6. Input sanitization (prevent injection)
 *   7. CSRF protection
 *   8. Privacy headers
 *   9. Legal metadata attachment
 *  10. Identity masking (on responses)
 */
export function applySecurityStack(router: Router): void {
  // Layer 1: Transport security
  router.use(SecureAPIGateway.enforceHTTPS.bind(SecureAPIGateway));

  // Layer 2: Security headers
  router.use(SecureAPIGateway.securityHeaders.bind(SecureAPIGateway));

  // Layer 3: IP blocking
  router.use(SecureAPIGateway.checkIPBlock.bind(SecureAPIGateway));

  // Layer 4: Threat detection
  router.use(ThreatDetection.detectAnomalies.bind(ThreatDetection));

  // Layer 5: Suspicious pattern detection
  router.use(SecureAPIGateway.detectSuspiciousActivity.bind(SecureAPIGateway));

  // Layer 6: Request size limits
  router.use(SecureAPIGateway.enforceRequestLimits.bind(SecureAPIGateway));

  // Layer 7: Input sanitization
  router.use(SecureAPIGateway.sanitizeInput.bind(SecureAPIGateway));

  // Layer 8: CSRF protection
  router.use(SecureAPIGateway.csrfProtection.bind(SecureAPIGateway));

  // Layer 9: Privacy headers
  router.use(PrivacyCompliance.privacyHeaders.bind(PrivacyCompliance));

  // Layer 10: Legal metadata
  router.use(GoodSamaritanPolicy.attachLegalMetadata.bind(GoodSamaritanPolicy));

  // Layer 11: Identity masking on responses
  router.use(IdentityMasking.maskResponse.bind(IdentityMasking));
}
