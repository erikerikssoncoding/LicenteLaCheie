"use client";

import useSWR from "swr";
import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) {
    throw new Error("Eroare la încărcarea datelor");
  }
  return res.json();
});

const ticketSchema = z.object({
  title: z.string().min(5, "Titlul trebuie să aibă cel puțin 5 caractere"),
  content: z
    .string()
    .min(30, "Descrierea trebuie să includă detalii relevante pentru consultant"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM")
});

type TicketValues = z.infer<typeof ticketSchema>;

export default function ClientDashboardPage() {
  const { data, error, isLoading, mutate } = useSWR("/api/tickets", fetcher);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const form = useForm<TicketValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: "",
      content: "",
      priority: "MEDIUM"
    }
  });

  const tickets = (data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
  }>;

  const onSubmit = form.handleSubmit(async (values) => {
    const response = await fetch("/api/tickets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(values)
    });

    if (response.ok) {
      form.reset();
      setIsDialogOpen(false);
      mutate();
    }
  });

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-8 flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Portal Client</h1>
            <p className="mt-2 text-sm text-slate-600">
              Vizualizați statusul solicitărilor și trimiteți noi cereri către echipa Licențe la Cheie.
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>Creează ticket nou</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ticket nou</DialogTitle>
                <DialogDescription>
                  Furnizați detalii despre solicitarea dvs. pentru a primi suport personalizat.
                </DialogDescription>
              </DialogHeader>
              <Form onSubmit={onSubmit}>
                <FormField name="title">
                  <FormLabel>Subiect</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Plan detaliat pentru capitolul 2" {...form.register("title")} />
                  </FormControl>
                  <FormMessage>{form.formState.errors.title?.message}</FormMessage>
                </FormField>

                <FormField name="content">
                  <FormLabel>Descriere</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descrieți cerințele, termenele limită și orice informații relevante pentru consultant."
                      rows={6}
                      {...form.register("content")}
                    />
                  </FormControl>
                  <FormMessage>{form.formState.errors.content?.message}</FormMessage>
                </FormField>

                <FormField name="priority">
                  <FormLabel>Prioritate</FormLabel>
                  <FormControl>
                    <select
                      className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
                      {...form.register("priority")}
                    >
                      <option value="LOW">Scăzută</option>
                      <option value="MEDIUM">Medie</option>
                      <option value="HIGH">Ridicată</option>
                    </select>
                  </FormControl>
                  <FormMessage>{form.formState.errors.priority?.message}</FormMessage>
                </FormField>

                <DialogFooter>
                  <DialogCloseButton variant="outline">Renunță</DialogCloseButton>
                  <Button type="submit">Trimite ticket</Button>
                </DialogFooter>
              </Form>
            </DialogContent>
          </Dialog>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          {isLoading && <p>Se încarcă datele...</p>}
          {error && (
            <p className="text-sm font-medium text-red-600">
              A apărut o eroare la preluarea ticketelor. Reîncercați mai târziu.
            </p>
          )}
          {!isLoading && !error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subiect</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prioritate</TableHead>
                  <TableHead>Creat la</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-slate-500">
                      Nu aveți încă tickete înregistrate.
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-medium text-slate-900">{ticket.title}</TableCell>
                      <TableCell>{ticket.status}</TableCell>
                      <TableCell>{ticket.priority}</TableCell>
                      <TableCell>
                        {new Intl.DateTimeFormat("ro-RO", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(new Date(ticket.createdAt))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
