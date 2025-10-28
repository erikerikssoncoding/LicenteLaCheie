"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

const contactSchema = z.object({
  name: z.string().min(2, "Introduceți un nume valid"),
  email: z.string().email("Introduceți o adresă de email validă"),
  message: z
    .string()
    .min(20, "Mesajul trebuie să conțină minim 20 de caractere pentru a înțelege solicitarea.")
});

type ContactFormValues = z.infer<typeof contactSchema>;

export default function ContactPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      message: ""
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setIsLoading(true);
    setIsSuccess(false);
    setError(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(values)
      });

      if (!response.ok) {
        throw new Error("Solicitarea nu a putut fi trimisă.");
      }

      setIsSuccess(true);
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "A apărut o eroare neașteptată. Vă rugăm să reîncercați."
      );
    } finally {
      setIsLoading(false);
    }
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 lg:flex-row">
        <div className="lg:w-1/2">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-brand">
            Contact • Consultanță
          </span>
          <h1 className="mt-6 text-4xl font-bold text-slate-900">
            Suntem aici pentru a vă oferi soluții academice complete
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Completați formularul și un consultant Licențe la Cheie vă va contacta în cel mult 24 de ore pentru a discuta detaliile proiectului.
          </p>
          <div className="mt-8 space-y-4 text-sm text-slate-600">
            <p>
              <strong className="font-semibold text-slate-900">Program:</strong> Luni - Vineri, 09:00 - 19:00
            </p>
            <p>
              <strong className="font-semibold text-slate-900">Email:</strong> contact@licentelacheie.ro
            </p>
            <p>
              <strong className="font-semibold text-slate-900">Telefon:</strong> +40 720 000 000
            </p>
          </div>
        </div>

        <div className="lg:w-1/2">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
            <Form onSubmit={onSubmit}>
              <FormField name="name">
                <FormLabel>Nume complet</FormLabel>
                <FormControl>
                  <Input placeholder="Nume și prenume" {...form.register("name")} />
                </FormControl>
                <FormMessage>{form.formState.errors.name?.message}</FormMessage>
              </FormField>

              <FormField name="email">
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="exemplu@domeniu.ro" {...form.register("email")} />
                </FormControl>
                <FormMessage>{form.formState.errors.email?.message}</FormMessage>
              </FormField>

              <FormField name="message">
                <FormLabel>Mesaj</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Descrieți pe scurt obiectivele și termenele proiectului dvs."
                    rows={6}
                    {...form.register("message")}
                  />
                </FormControl>
                <FormMessage>{form.formState.errors.message?.message}</FormMessage>
              </FormField>

              {isSuccess && (
                <p className="rounded-md bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                  Mesajul dvs. a fost transmis cu succes. Vă mulțumim!
                </p>
              )}

              {error && (
                <p className="rounded-md bg-red-50 p-3 text-sm font-medium text-red-600">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Se transmite..." : "Trimite mesajul"}
              </Button>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}
