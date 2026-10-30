/**
 * What a person is told when the service cannot check sign-ins right now:
 * `/v1/me` answers `reason: "check-unavailable"`, and the library
 * `503 SIGN_IN_CHECK_UNAVAILABLE`. The service's problem, not the
 * sign-in's, so nobody is told to sign in again. No Node API here: the
 * library client uses it too.
 */
export const SIGN_IN_CHECK_UNAVAILABLE = "The Protoboard service can't check sign-ins right now. Try again later.";
