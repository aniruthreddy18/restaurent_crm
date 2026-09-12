"use client";

/** Last-resort boundary: catches failures in the root layout itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1rem", fontWeight: 600 }}>Restaurant CRM is temporarily unavailable</h1>
        <p style={{ marginTop: "0.5rem", color: "#666", fontSize: "0.875rem" }}>
          Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button
          onClick={reset}
          style={{ marginTop: "1.5rem", padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "1px solid #ddd", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
