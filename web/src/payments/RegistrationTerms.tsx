import { useState } from "react";
import { api, errorMessage } from "./api";

/** Keep in step with TERMS.registrationTermsVersion in functions/src/config.ts. */
export const REGISTRATION_TERMS_VERSION = "2026-11-01";

/**
 * Shown at sign-up, and again at checkout if the account terms changed since the
 * resident last accepted. Acceptance is recorded by the server with its own timestamp.
 */
export function RegistrationTermsPrompt({ onAccepted, termsHref = "/terms" }: { onAccepted: () => void; termsHref?: string }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptTerms({ version: REGISTRATION_TERMS_VERSION });
      onAccepted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tl-pay">
      <p>Before you book, review and accept the Trash Lad account terms.</p>
      <label className="tl-pay-check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>
          I've read and agree to the <a href={termsHref} target="_blank" rel="noreferrer">Trash Lad account terms</a> and privacy policy.
        </span>
      </label>
      {error && <p role="alert" className="tl-pay-error">{error}</p>}
      <button className="tl-pay-button" onClick={accept} disabled={!checked || busy}>
        {busy ? "Saving…" : "Accept and continue"}
      </button>
    </div>
  );
}
