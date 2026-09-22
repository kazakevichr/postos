"use client";

// Новое направление: только название. Валюта, KPI, бренды и завод
// настраиваются в карточке, которая появится в списке выше.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setNote("");
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setNote(j.error || "не получилось");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <div className="card">
      <h2 className="font-semibold mb-2">Новое направление</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Название, например MoneyBall"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Создаю…" : "Создать"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Бренды соцсетей и завода подставятся по названию: «MoneyBall» получит бренд MoneyBall сам.
      </p>
      {note && <p className="text-sm text-red-600 mt-2">{note}</p>}
    </div>
  );
}
