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

const loginSchema = z.object({
  email: z.string().email("Introduceți o adresă de email validă"),
  password: z.string().min(6, "Parola trebuie să conțină minim 6 caractere")
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: ""
    }
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setIsSubmitting(true);
    const response = await signIn("credentials", {
      ...values,
      redirect: false
    });

    setIsSubmitting(false);
    if (response?.error) {
      setError("Autentificare eșuată. Verificați datele introduse.");
      return;
    }

    router.push("/dashboard/client");
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-white px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Autentificare</h1>
          <p className="mt-2 text-sm text-slate-600">
            Accesați platforma Licențe la Cheie pentru a vă administra solicitările.
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

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Se autentifică..." : "Autentificare"}
          </Button>
        </Form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Nu aveți cont?{" "}
          <Link
            href="/register"
            className="font-semibold text-indigo-600 transition hover:text-indigo-700"
          >
            Înregistrați-vă
          </Link>
        </p>
      </div>
    </div>
  );
}
