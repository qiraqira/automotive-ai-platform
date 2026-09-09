"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The first real interactive (Client Component) piece of apps/web — every
// other page so far is a pure Server Component with zero client JS (spec
// §63 "not a huge client-side application"). A login form is the one
// genuine exception: it needs to react to user input before a server
// round-trip makes sense. Posts to our own /api/admin/login route (see
// that file for why it's a same-origin proxy, not a direct cross-origin
// call to apps/api).
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error === "invalid_credentials" ? "Invalid email or password." : data.error ?? "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style={{ maxWidth: 320 }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Admin login</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", marginBottom: 12 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 16 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        {error && <p style={{ color: "var(--accent)", marginBottom: 12 }}>{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: "8px 16px", fontFamily: "Arial, sans-serif", cursor: submitting ? "default" : "pointer" }}
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </section>
  );
}
