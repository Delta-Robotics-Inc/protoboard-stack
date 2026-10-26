/** Types for scripts/check-licence-files.mjs (used by packages/cli/test/licence-files.test.ts). */
export interface LicenceProblem {
  path: string;
  problem: string;
}
export const LICENSE_ID: "Apache-2.0";
export const APACHE_2_SHA256: string;
export const ROOT_FILES: string[];
export function checkLicenceFiles(root: string): LicenceProblem[];
export function checkPackageLicences(root: string, dirs: string[]): LicenceProblem[];
