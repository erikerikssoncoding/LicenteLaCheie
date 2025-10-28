import { Button } from "@/components/ui/button";

const highlights = [
  {
    title: "Expertiză academică garantată",
    description:
      "Echipa noastră este formată din profesori universitari și consultanți cu experiență vastă în cercetare și redactare academică."
  },
  {
    title: "Proces complet transparent",
    description:
      "Dashboard-ul dedicat vă permite să urmăriți progresul lucrării, să comunicați cu echipa și să încărcați documente în siguranță."
  },
  {
    title: "Respectăm standardele universitare",
    description:
      "Fiecare lucrare este verificată riguros pentru originalitate, structură și conformitate cu cerințele instituției dvs."
  }
];

const services = [
  {
    title: "Lucrări de Licență",
    description:
      "Consultanță completă de la alegerea temei până la pregătirea prezentării finale, adaptată domeniului dvs."
  },
  {
    title: "Disertații și Master",
    description:
      "Structurăm și redactăm proiecte de master cu argumentație solidă și bibliografie academică actualizată."
  },
  {
    title: "Lucrări de Doctorat",
    description:
      "Sprijin în cercetare, analiză și redactare pentru proiecte doctorale complexe și interdisciplinare."
  }
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-slate-100 to-white">
      <header className="border-b border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand px-4 py-2 text-lg font-semibold text-brand-foreground">
              Lc
            </div>
            <div>
              <p className="text-base font-semibold uppercase tracking-wide text-brand">
                Licențe la Cheie
              </p>
              <p className="text-sm text-slate-500">
                Centrul de Excelență în Cercetare Aplicată
              </p>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 md:flex">
            <a href="#servicii">Servicii</a>
            <a href="#proces">Proces</a>
            <a href="#testimoniale">Testimoniale</a>
            <a href="/contact">Contact</a>
          </nav>
          <div className="hidden md:block">
            <Button asChild>
              <a href="/login">Autentificare</a>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 lg:flex-row lg:items-center">
          <div className="flex-1 space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-brand">
              Academie • Cercetare • Inovație
            </span>
            <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">
              Partenerul dvs. de încredere pentru lucrări academice impecabile
            </h1>
            <p className="text-lg text-slate-600">
              La Licențe la Cheie, transformăm obiectivele academice în reușite concrete. Oferim servicii personalizate pentru lucrări de licență, disertație și doctorat, cu accent pe profesionalism, confidențialitate și originalitate.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="w-full sm:w-auto" asChild>
                <a href="/contact">Solicită o consultanță</a>
              </Button>
              <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
                <a href="#servicii">Explorează serviciile</a>
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 p-8 text-brand-foreground shadow-xl">
              <p className="text-sm uppercase tracking-wider text-brand-foreground/70">
                Indicatori academici
              </p>
              <div className="mt-6 grid grid-cols-2 gap-6 text-center">
                <div>
                  <p className="text-4xl font-bold">850+</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-brand-foreground/80">
                    Lucrări finalizate
                  </p>
                </div>
                <div>
                  <p className="text-4xl font-bold">98%</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-brand-foreground/80">
                    Rată de reușită
                  </p>
                </div>
                <div>
                  <p className="text-4xl font-bold">60+</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-brand-foreground/80">
                    Consultanți acreditați
                  </p>
                </div>
                <div>
                  <p className="text-4xl font-bold">24/7</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-brand-foreground/80">
                    Suport dedicat
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="servicii" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="max-w-2xl">
            <h2 className="section-title">Servicii integrate pentru fiecare etapă academică</h2>
            <p className="mt-3 section-subtitle">
              Abordăm fiecare proiect cu rigoare metodologică, cercetare aprofundată și livrabile adaptate cerințelor instituției.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {services.map((service) => (
              <div
                key={service.title}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <h3 className="text-xl font-semibold text-slate-900">{service.title}</h3>
                <p className="mt-3 text-sm text-slate-600">{service.description}</p>
                <div className="mt-auto pt-6">
                  <Button variant="ghost" asChild>
                    <a href="/contact">Programează o discuție</a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proces" className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="section-title">Procesul nostru strategic</h2>
            <p className="mt-4 text-slate-600">
              Colaborarea cu Licențe la Cheie este structurată pentru a vă oferi claritate și control permanent asupra proiectului.
            </p>
            <ul className="mt-8 space-y-6">
              <li className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Analiză inițială și stabilirea obiectivelor</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Evaluăm cerințele universității și definim împreună planul de lucru, livrabilele și calendarul.
                </p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Cercetare și dezvoltare conținut</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Echipa noastră produce conținut original, susținut de bibliografie actuală și analize riguroase.
                </p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Revizie, predare și pregătire susținere</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Realizăm ajustări finale, pregătim prezentarea și simulăm sesiuni de susținere pentru rezultate excelente.
                </p>
              </li>
            </ul>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-900 p-8 text-brand-foreground shadow-xl">
            <h3 className="text-2xl font-semibold">Platformă digitală de management</h3>
            <p className="mt-4 text-sm text-brand-foreground/80">
              Dashboard-ul nostru securizat vă oferă vizibilitate totală asupra proiectului: actualizări în timp real, comunicare directă cu consultanții și istoricul livrabilelor.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="rounded-xl bg-white/10 p-4">
                <p className="text-lg font-semibold">Ticketing intuitiv</p>
                <p className="mt-2 text-sm text-brand-foreground/80">
                  Monitorizați solicitările și primiți răspunsuri rapide de la echipa academică.
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-4">
                <p className="text-lg font-semibold">Calendar inteligent</p>
                <p className="mt-2 text-sm text-brand-foreground/80">
                  Vizualizați termenele importante și planificați sesiunile de consultanță.
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-4">
                <p className="text-lg font-semibold">Arhivă documente</p>
                <p className="mt-2 text-sm text-brand-foreground/80">
                  Acces securizat la versiuni intermediare și finale ale lucrării.
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-4">
                <p className="text-lg font-semibold">Notificări proactive</p>
                <p className="mt-2 text-sm text-brand-foreground/80">
                  Fiți informat în permanență despre statusul proiectului și livrabilele noi.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="testimoniale" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="max-w-3xl">
            <h2 className="section-title">Ce spun absolvenții și cadrele didactice</h2>
            <p className="mt-4 text-slate-600">
              Încrederea partenerilor noștri se reflectă în rezultatele remarcabile obținute an de an.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-slate-900 py-10 text-brand-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold uppercase tracking-wide">
              Licențe la Cheie
            </p>
            <p className="text-sm text-brand-foreground/80">
              Excelență academică, rezultate dovedite.
            </p>
          </div>
          <div className="text-sm text-brand-foreground/70">
            &copy; {new Date().getFullYear()} Licențe la Cheie. Toate drepturile rezervate.
          </div>
        </div>
      </footer>
    </main>
  );
}
