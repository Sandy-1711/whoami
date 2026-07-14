// The human-in-the-loop confirmation gate. Any tool that does something
// irreversible or outward-facing (send an email, push to GitHub, edit identity
// facts) calls deps.confirm(question) and proceeds only on `true`. The CLI wires
// a real terminal prompt; the model has no way to answer on the user's behalf.
export type ConfirmGate = (question: string) => Promise<boolean>;

// A gate that always refuses — the safe default for non-interactive contexts and
// tests, so a missing wiring can never silently auto-approve a send.
export const denyGate: ConfirmGate = async () => false;

// A gate that always approves — ONLY for tests that intentionally exercise the
// post-confirmation path. Never use in production wiring.
export const allowGate: ConfirmGate = async () => true;
