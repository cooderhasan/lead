import type { Metadata } from "next";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Kayıt" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">AI satış departmanınızı kurun</h1>
      <p className="mb-6 mt-1 text-sm text-text-2">Birkaç dakikada şirketinizi tanıtın, gerisini AI ile birlikte yapalım.</p>
      <RegisterForm />
    </>
  );
}
