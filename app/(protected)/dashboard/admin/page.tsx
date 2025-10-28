"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) {
    throw new Error("Eroare la încărcarea datelor");
  }
  return res.json();
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"])
});

interface Ticket {
  id: string;
  title: string;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  author: {
    email: string;
  };
  createdAt: string;
}

export default function AdminDashboardPage() {
  const { data, error, isLoading, mutate } = useSWR<Ticket[]>("/api/tickets", fetcher);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [formState, setFormState] = useState<z.infer<typeof updateSchema>>({
    status: "OPEN",
    priority: "MEDIUM"
  });

  const tickets = useMemo(() => data ?? [], [data]);

  const handleOpen = (ticket: Ticket) => {
    setEditingTicket(ticket);
    setFormState({ status: ticket.status, priority: ticket.priority });
  };

  const handleUpdate = async () => {
    if (!editingTicket) return;
    const parsed = updateSchema.safeParse(formState);
    if (!parsed.success) return;

    const response = await fetch(`/api/tickets/${editingTicket.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(parsed.data)
    });

    if (response.ok) {
      setEditingTicket(null);
      await mutate();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900">Panou Administrativ</h1>
          <p className="mt-2 text-sm text-slate-600">
            Gestionați toate solicitările clienților, actualizați statusul și stabiliți prioritățile.
          </p>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
          {isLoading && <p>Se încarcă datele...</p>}
          {error && (
            <p className="text-sm font-medium text-red-600">
              Nu am putut prelua lista de ticket. Încercați din nou mai târziu.
            </p>
          )}

          {!isLoading && !error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subiect</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prioritate</TableHead>
                  <TableHead>Creat</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-slate-500">
                      Nu există ticket-uri înregistrate.
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-medium text-slate-900">{ticket.title}</TableCell>
                      <TableCell>{ticket.author.email}</TableCell>
                      <TableCell>{ticket.status}</TableCell>
                      <TableCell>{ticket.priority}</TableCell>
                      <TableCell>
                        {new Intl.DateTimeFormat("ro-RO", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(new Date(ticket.createdAt))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog open={editingTicket?.id === ticket.id} onOpenChange={(open) => (open ? handleOpen(ticket) : setEditingTicket(null))}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              Editează
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Editare ticket</DialogTitle>
                              <DialogDescription>
                                Actualizați statusul și prioritatea pentru a menține fluxul de lucru eficient.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">Status</p>
                                <Select
                                  value={formState.status}
                                  onValueChange={(value) => setFormState((prev) => ({ ...prev, status: value as Ticket["status"] }))}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selectează statusul" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="OPEN">Deschis</SelectItem>
                                    <SelectItem value="IN_PROGRESS">În lucru</SelectItem>
                                    <SelectItem value="CLOSED">Închis</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">Prioritate</p>
                                <Select
                                  value={formState.priority}
                                  onValueChange={(value) => setFormState((prev) => ({ ...prev, priority: value as Ticket["priority"] }))}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selectează prioritatea" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="LOW">Scăzută</SelectItem>
                                    <SelectItem value="MEDIUM">Medie</SelectItem>
                                    <SelectItem value="HIGH">Ridicată</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setEditingTicket(null)}>
                                Renunță
                              </Button>
                              <Button onClick={handleUpdate}>Salvează</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
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
