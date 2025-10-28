"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const registerSchema = z
  .object({
    email: z.string().email("Introduceți o adresă de email validă"),
    password: z.string().min(6, "Parola trebuie să conțină minim 6 caractere"),
    confirmPassword: z.string().min(6, "Parola trebuie să conțină minim 6 caractere")
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Parolele nu coincid",
    path: ["confirmPassword"]
  });

type RegisterValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: ""
    }
  });

  const handleSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Înregistrarea a eșuat. Încercați din nou.");
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false
      });

      if (signInResult?.error) {
        setError(
          "Contul a fost creat, dar autentificarea automată a eșuat. Încercați să vă conectați."
        );
        return;
      }

      router.push("/dashboard/client");
    } catch (err) {
      console.error(err);
      setError("A apărut o eroare neașteptată. Încercați din nou.");
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-white px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Înregistrare</h1>
          <p className="mt-2 text-sm text-slate-600">
            Creați-vă un cont pentru a trimite și urmări solicitările către Licențe la
            Cheie.
          </p>
        </div>

        <Form onSubmit={handleSubmit}>
          <FormField name="email">
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input
                type="email"
                placeholder="exemplu@domeniu.ro"
                {...form.register("email")}
              />
            </FormControl>
            <FormMessage>{form.formState.errors.email?.message}</FormMessage>
          </FormField>

          <FormField name="password">
            <FormLabel>Parola</FormLabel>
            <FormControl>
              <Input
                type="password"
                placeholder="••••••"
                {...form.register("password")}
              />
            </FormControl>
            <FormMessage>{form.formState.errors.password?.message}</FormMessage>
          </FormField>

          <FormField name="confirmPassword">
            <FormLabel>Confirmare parolă</FormLabel>
            <FormControl>
              <Input
                type="password"
                placeholder="••••••"
                {...form.register("confirmPassword")}
              />
            </FormControl>
            <FormMessage>
              {form.formState.errors.confirmPassword?.message}
            </FormMessage>
          </FormField>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Se înregistrează..." : "Creează cont"}
          </Button>
        </Form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Aveți deja cont? {" "}
          <Link
            href="/login"
            className="font-semibold text-indigo-600 transition hover:text-indigo-700"
          >
            Autentificați-vă
          </Link>
        </p>
      </div>
    </div>
  );
}
