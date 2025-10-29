export const PROJECT_FLOW_STATUSES = [
  {
    id: 'new',
    label: 'Proiect Nou / Inregistrat',
    description: 'Am primit comanda ta. Un manager de proiect o va analiza în curând.',
    phase: 'initiation',
    clientMessage:
      'Am primit comanda ta. Un manager de proiect o va analiza în curând și te vom anunța când avem următorii pași.'
  },
  {
    id: 'waiting_docs',
    label: 'Așteptare Documentație',
    description: 'Așteptăm materialele necesare pentru a începe.',
    phase: 'initiation',
    clientMessage:
      'Așteptăm de la tine materialele necesare (structură, bibliografie, cerințe specifice) pentru a începe.'
  },
  {
    id: 'docs_validated',
    label: 'Validare Documentație / Alocare Redactor',
    description: 'Verificăm documentația și alegem specialistul potrivit.',
    phase: 'initiation',
    clientMessage:
      'Am primit materialele tale. Le analizăm și selectăm cel mai potrivit specialist pentru tema ta.'
  },
  {
    id: 'research',
    label: 'Documentare și Structurare',
    description: 'Redactorul studiază bibliografia și finalizează structura.',
    phase: 'execution',
    clientMessage:
      'Redactorul a început proiectul. În acest moment se parcurge bibliografia și se definitivează structura lucrării.'
  },
  {
    id: 'writing',
    label: 'Redactare Conținut',
    description: 'Se redactează conținutul lucrării capitol cu capitol.',
    phase: 'execution',
    clientMessage:
      'Specialistul nostru redactează conținutul lucrării tale, capitol cu capitol.'
  },
  {
    id: 'internal_review',
    label: 'Revizuire Internă și Verificare Calitate',
    description: 'Textul este verificat intern și analizat anti-plagiat.',
    phase: 'execution',
    clientMessage:
      'Textul este gata. Acum trece printr-un proces intern de corectură, verificare stilistică și analiză anti-plagiat.'
  },
  {
    id: 'draft_delivery',
    label: 'Predare Parțială / Livrare Draft',
    description: 'Se livrează un draft sau o parte convenită.',
    phase: 'delivery',
    clientMessage:
      'Un draft al lucrării (sau o parte din ea) a fost încărcat în contul tău. Te rugăm să îl analizezi.'
  },
  {
    id: 'awaiting_feedback',
    label: 'Așteptare Feedback Client',
    description: 'Așteptăm confirmarea sau solicitările de modificări.',
    phase: 'delivery',
    clientMessage:
      'Am predat lucrarea. Așteptăm confirmarea ta sau o listă de modificări, dacă este cazul.'
  },
  {
    id: 'changes_requested',
    label: 'Solicitare Modificări',
    description: 'Clientul a cerut modificări ce urmează să fie analizate.',
    phase: 'finalization',
    clientMessage: 'Am primit solicitările tale de modificare. Redactorul le analizează.'
  },
  {
    id: 'applying_changes',
    label: 'În Curs de Modificare',
    description: 'Se lucrează la implementarea modificărilor solicitate.',
    phase: 'finalization',
    clientMessage: 'Se lucrează la implementarea modificărilor solicitate de tine.'
  },
  {
    id: 'final_delivery',
    label: 'Predare Finală',
    description: 'Versiunea finală a lucrării este încărcată în cont.',
    phase: 'finalization',
    clientMessage:
      'Versiunea finală, incluzând modificările tale, a fost încărcată în cont. Proiectul este aproape gata.'
  },
  {
    id: 'completed',
    label: 'Proiect Finalizat / Arhivat',
    description: 'Proiectul este închis și arhivat pentru acces ulterior.',
    phase: 'finalization',
    clientMessage:
      'Proiectul este încheiat. Îți mulțumim! Lucrarea este disponibilă pentru descărcare în arhiva ta.'
  }
];

export const PROJECT_SPECIAL_STATUSES = [
  {
    id: 'suspended_payment',
    label: 'Suspendat (Așteptare Plată)',
    description: 'Proiectul este suspendat până la confirmarea plății.',
    phase: 'suspended',
    clientMessage: 'Proiectul este în pauză până la confirmarea plății tranșei următoare.'
  },
  {
    id: 'suspended_info',
    label: 'Suspendat (Info Suplimentare Client)',
    description: 'Proiectul este suspendat până la clarificările clientului.',
    phase: 'suspended',
    clientMessage: 'Redactorul are nevoie de lămuriri din partea ta pentru a putea continua. Te rugăm să verifici mesajele.'
  },
  {
    id: 'cancelled',
    label: 'Anulat',
    description: 'Proiectul a fost oprit conform solicitării sau contractului.',
    phase: 'cancelled',
    clientMessage:
      'Proiectul a fost anulat conform solicitării tale sau termenilor contractuali. Ne poți contacta pentru clarificări.'
  }
];

export const PROJECT_STATUSES = [...PROJECT_FLOW_STATUSES, ...PROJECT_SPECIAL_STATUSES];

const STATUS_INDEX = new Map(PROJECT_STATUSES.map((status, index) => [status.id, index]));
const FLOW_INDEX = new Map(PROJECT_FLOW_STATUSES.map((status, index) => [status.id, index]));

export function getProjectStatusById(statusId) {
  return PROJECT_STATUSES.find((status) => status.id === statusId) || null;
}

export function getProjectStatusLabel(statusId) {
  return getProjectStatusById(statusId)?.label || statusId;
}

export function getNextProjectStatusId(currentStatusId) {
  const index = FLOW_INDEX.get(currentStatusId);
  if (index === undefined) {
    return null;
  }
  const next = PROJECT_FLOW_STATUSES[index + 1];
  return next ? next.id : null;
}

export function getPreviousProjectStatusId(currentStatusId) {
  const index = FLOW_INDEX.get(currentStatusId);
  if (index === undefined) {
    return null;
  }
  const previous = PROJECT_FLOW_STATUSES[index - 1];
  return previous ? previous.id : null;
}

export function isValidProjectStatus(statusId) {
  return STATUS_INDEX.has(statusId);
}

export function buildProjectStatusDictionary() {
  return PROJECT_STATUSES.reduce((acc, status) => {
    acc[status.id] = status;
    return acc;
  }, {});
}
