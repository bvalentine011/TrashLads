import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../data/DataContext";
import { DEMO_ACCOUNTS } from "../data/demoSource";
import { TERMS } from "../data/rules";

function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "That email and password don't match. Try again or reset your password.";
  if (code.includes("email-already-in-use")) return "There's already an account with that email. Sign in instead.";
  if (code.includes("weak-password")) return "Use a password with at least 8 characters.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  return (err as Error)?.message || "Something went wrong. Try again.";
}

export function SignIn() {
  const { data, user } = useData();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || null;
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) nav(next ?? (user.isOwner ? "/owner" : "/book"), { replace: true });
  }, [user, next, nav]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "up") {
      if (f.name.trim().length < 2) return setError("Enter your name.");
      if (f.phone.replace(/\D/g, "").length < 10) return setError("Enter a 10-digit phone number.");
      if (f.password.length < 8) return setError("Use a password with at least 8 characters.");
      if (!terms) return setError("Accept the account terms to create an account.");
    }
    setBusy(true);
    try {
      if (mode === "in") await data.signIn(f.email, f.password);
      else if (mode === "up") await data.signUp({ name: f.name.trim(), email: f.email.trim(), phone: f.phone, password: f.password, acceptedTermsVersion: TERMS.registrationTermsVersion });
      else {
        await data.sendPasswordReset(f.email.trim());
        setNotice("If there's an account for that email, a reset link is on its way.");
        setMode("in");
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function demo(email: string) {
    setBusy(true);
    try {
      await data.signIn(email, "demo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div>
        <h1 className="page-title">{mode === "up" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in"}</h1>
        <p className="page-sub">{mode === "up" ? "You'll use it to book and manage pickups." : mode === "reset" ? "We'll email you a link to set a new one." : "Sign in to book and manage your pickups."}</p>
      </div>

      {data.mode === "demo" && mode === "in" && (
        <div className="card demo-accounts">
          <p className="label">Try the demo</p>
          <button className="btn btn-dark" onClick={() => demo(DEMO_ACCOUNTS.resident)} disabled={busy}>Continue as a resident</button>
          <button className="btn btn-outline" onClick={() => demo(DEMO_ACCOUNTS.owner)} disabled={busy}>Continue as the owner</button>
        </div>
      )}

      <form className="card" onSubmit={submit} noValidate>
        {mode === "up" && (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" autoComplete="name" value={f.name} onChange={set("name")} />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={f.email} onChange={set("email")} required />
        </div>
        {mode === "up" && (
          <div className="field">
            <label htmlFor="phone">Mobile phone</label>
            <input id="phone" className="input" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} />
            <span className="hint">For pickup-night texts once messaging is set up.</span>
          </div>
        )}
        {mode !== "reset" && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={f.password} onChange={set("password")} />
          </div>
        )}
        {mode === "up" && (
          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>I agree to the <Link to="/terms" target="_blank">Trash Lads account terms</Link> and privacy policy.</span>
          </label>
        )}
        {error && <p className="alert" role="alert">{error}</p>}
        {notice && <p className="note" role="status">{notice}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? "One moment…" : mode === "up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
        </button>
        <div className="split small">
          {mode === "in" ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => setMode("up")}>Create an account</button>
              <button type="button" className="btn-ghost" onClick={() => setMode("reset")}>Forgot password?</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setMode("in")}>Back to sign in</button>
          )}
        </div>
      </form>
    </div>
  );
}
