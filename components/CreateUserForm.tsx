"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateUserForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fixedSalary, setFixedSalary] = useState("15000");
  const [role, setRole] = useState("MANAGER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, fixedSalary, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Не удалось добавить сотрудника");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setFixedSalary("15000");
      router.refresh();
    } catch {
      setError("Не удалось добавить сотрудника. Проверьте соединение и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card grid grid-cols-1 sm:grid-cols-4 gap-3">
      {error && <p className="sm:col-span-4 text-sm text-red-600">{error}</p>}
      <input className="input" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="input" placeholder="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <input className="input" placeholder="Оклад" type="number" value={fixedSalary} onChange={(e) => setFixedSalary(e.target.value)} />
      <select className="input sm:col-span-2" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="MANAGER">Менеджер партнёров — партнёрский менеджмент</option>
        <option value="SMM">СММ — только блок СММ: завод, план, статистика</option>
        <option value="PARTNER">Партнёр — видит своё направление целиком, но ничего не меняет</option>
      </select>
      <button className="btn btn-primary sm:col-span-2" disabled={busy} type="submit">
        {busy ? "Добавляем…" : "Добавить сотрудника"}
      </button>
    </form>
  );
}
