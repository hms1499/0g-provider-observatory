/**
 * What each guarantee mode means, in the words a reader needs before comparing anything.
 *
 * `standard` carries a technical reason and is never scored down. Nobody can place a closed
 * third-party API inside their own TDX enclave, so running in `standard` mode is a property
 * of what is being served, not a failing of who serves it. Section 08 of the design doc:
 * explain before ranking.
 */
export const MODE_NOTES: Record<string, { label: string; means: string }> = {
  TeeML: {
    label: 'TeeML',
    means:
      'The model itself ran inside a hardware enclave, and the result carries an attestation ' +
      'a third party can check. This is the strongest claim on the network.',
  },
  TeeTLS: {
    label: 'TeeTLS',
    means:
      'The transport into the provider is protected by an enclave-terminated channel. What ' +
      'happened to the request after that is not attested.',
  },
  standard: {
    label: 'standard',
    means:
      'No enclave attestation, because the model is a closed third-party API the operator ' +
      'cannot place inside their own enclave. This is a property of the model being served, ' +
      'not a shortcoming of the operator.',
  },
};

export function modeNote(mode: string): { label: string; means: string } {
  return (
    MODE_NOTES[mode] ?? {
      label: mode,
      means: 'This mode was not recorded on chain, so we do not know what it guarantees.',
    }
  );
}
