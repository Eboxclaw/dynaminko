import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Shell } from "@/components/pot/Shell";
import { useDoc } from "@/hooks/useDoc";
import { relativeTime } from "@/lib/format";
import { addThesis, patchThesis, removeThesis } from "@/lib/store";

export const Route = createFileRoute("/theses")({
  head: () => ({
    meta: [
      { title: "Theses — Proof of Thesis" },
      {
        name: "description",
        content: "What you believe, written down before the trade — the thing your trades are measured against.",
      },
      { property: "og:title", content: "Theses — Proof of Thesis" },
      { property: "og:description", content: "What you believe, written down before the trade." },
    ],
  }),
  component: ThesesPage,
});

function ThesesPage() {
  const doc = useDoc();
  const [title, setTitle] = useState("");

  return (
    <Shell title="Theses" subtitle={`${doc.theses.length} written`}>
      <section className="doodle-card animate-rise p-5">
        <p className="font-hand text-xl text-accent">What do you believe?</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              addThesis({ title: title.trim() });
              setTitle("");
            }
          }}
          placeholder="Compute stays scarce through 2027"
          className="mt-3 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled={!title.trim()}
          onClick={() => {
            addThesis({ title: title.trim() });
            setTitle("");
          }}
          className="doodle-pill mt-3 bg-ink px-4 py-1.5 text-[13px] font-medium text-paper disabled:opacity-40"
        >
          Write it down
        </button>
      </section>

      <ul className="mt-5 space-y-3">
        {doc.theses.map((t) => (
          <li key={t.id} className="doodle-card animate-rise p-4">
            <p className="text-[15px]">{t.title}</p>
            <p className="mt-1 text-[12px] text-ink-faint">
              {t.status} · updated {relativeTime(t.updatedAt)}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  patchThesis(t.id, { status: t.status === "open" ? "played-out" : "open" })
                }
                className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft"
              >
                {t.status === "open" ? "Mark played out" : "Reopen"}
              </button>
              <button
                type="button"
                onClick={() => patchThesis(t.id, { status: "invalidated" })}
                className="doodle-pill px-3 py-1 text-[12px] hover:bg-accent-soft"
              >
                Invalidated
              </button>
              <button
                type="button"
                onClick={() => removeThesis(t.id)}
                className="ml-auto text-[12px] text-ink-faint hover:text-loss"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {doc.theses.length === 0 && (
          <p className="py-6 text-center font-hand text-xl text-ink-faint">
            nothing written yet
          </p>
        )}
      </ul>
    </Shell>
  );
}
