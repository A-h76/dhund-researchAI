import { FeatureFlagsService } from './feature-flags.service';

export function evaluateAuthorizationDecision(
  isAuthenticated: boolean,
  featureFlags: FeatureFlagsService,
): 'allow' | 'deny' {
  void featureFlags;
  return isAuthenticated ? 'allow' : 'deny';
}
