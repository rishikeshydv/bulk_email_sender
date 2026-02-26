"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  createdAt: string;
};

type DeliveryRow = {
  id: string;
  status: "PENDING" | "SENT" | "FAILED";
  error: string | null;
  sentAt: string | null;
  recipient: { email: string; name: string | null };
};

type Campaign = {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  deliveries: DeliveryRow[];
};

type SendResult = {
  campaignId: string;
  sentCount: number;
  failedCount: number;
  results: Array<{
    recipientId: string;
    email: string;
    status: "SENT" | "FAILED";
    error?: string;
    sentAt?: string;
  }>;
};

type DomainGroup = {
  domain: string;
  recipients: Recipient[];
};

function parseRecipientInput(raw: string) {
  const parsedRecipients = new Map<string, { email: string; firstName: string }>();
  const invalidLines: number[] = [];

  raw.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const [firstNameRaw, emailRaw] = trimmed.split(",").map((value) => value.trim());
    const firstName = firstNameRaw?.trim();
    const email = emailRaw?.trim().toLowerCase();

    if (!firstName || !email) {
      invalidLines.push(index + 1);
      return;
    }

    parsedRecipients.set(email, { email, firstName });
  });

  return {
    recipients: Array.from(parsedRecipients.values()),
    invalidLines,
  };
}

async function loadRecipients(): Promise<Recipient[]> {
  const response = await fetch("/api/recipients");
  if (!response.ok) {
    throw new Error("Failed to load recipients");
  }

  const data = (await response.json()) as { recipients: Recipient[] };
  return data.recipients;
}

async function loadCampaigns(): Promise<Campaign[]> {
  const response = await fetch("/api/campaigns");
  if (!response.ok) {
    throw new Error("Failed to load campaigns");
  }

  const data = (await response.json()) as { campaigns: Campaign[] };
  return data.campaigns;
}

async function fetchDashboardData() {
  const [recipients, campaigns] = await Promise.all([loadRecipients(), loadCampaigns()]);
  return { recipients, campaigns };
}

function getCompanyDomain(email: string) {
  const [, domain] = email.toLowerCase().split("@");
  return domain || "unknown";
}

export default function Home() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [activeDomainFilter, setActiveDomainFilter] = useState<string | null>(null);
  const [bulkAddInput, setBulkAddInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();

  const domainGroups: DomainGroup[] = (() => {
    const groups = new Map<string, Recipient[]>();

    for (const recipient of recipients) {
      const domain = getCompanyDomain(recipient.email);
      const existing = groups.get(domain);
      if (existing) {
        existing.push(recipient);
      } else {
        groups.set(domain, [recipient]);
      }
    }

    return Array.from(groups.entries())
      .map(([domain, groupedRecipients]) => ({
        domain,
        recipients: groupedRecipients.sort((a, b) => a.email.localeCompare(b.email)),
      }))
      .sort((a, b) => b.recipients.length - a.recipients.length || a.domain.localeCompare(b.domain));
  })();

  const filteredRecipients = (() => {
    const query = search.trim().toLowerCase();
    return recipients.filter((recipient) => {
      const matchesSearch =
        !query ||
        recipient.email.toLowerCase().includes(query) ||
        recipient.name?.toLowerCase().includes(query) ||
        getCompanyDomain(recipient.email).includes(query);

      const matchesDomain =
        !activeDomainFilter || getCompanyDomain(recipient.email) === activeDomainFilter;

      return matchesSearch && matchesDomain;
    });
  })();

  const visibleDomainGroups = domainGroups.filter((group) => {
    const domainMatchesFilter = !activeDomainFilter || group.domain === activeDomainFilter;
    const query = search.trim().toLowerCase();

    if (!domainMatchesFilter) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      group.domain.includes(query) ||
      group.recipients.some(
        (recipient) =>
          recipient.email.toLowerCase().includes(query) ||
          recipient.name?.toLowerCase().includes(query),
      )
    );
  });

  const selectedCount = selectedIds.length;
  const selectedIdSet = new Set(selectedIds);
  const allFilteredSelected =
    filteredRecipients.length > 0 &&
    filteredRecipients.every((recipient) => selectedIds.includes(recipient.id));

  async function refreshAll() {
    setErrorMessage(null);
    const data = await fetchDashboardData();
    setRecipients(data.recipients);
    setCampaigns(data.campaigns);
    setSelectedIds((current) =>
      current.filter((id) => data.recipients.some((recipient) => recipient.id === id)),
    );
  }

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const data = await fetchDashboardData();
        setRecipients(data.recipients);
        setCampaigns(data.campaigns);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load dashboard data.",
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function handleAddRecipients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    const parsedInput = parseRecipientInput(bulkAddInput);
    if (parsedInput.recipients.length === 0) {
      setErrorMessage("Add at least one recipient in the format FirstName,email@example.com.");
      return;
    }

    if (parsedInput.invalidLines.length > 0) {
      setErrorMessage(
        `Invalid recipient format on line${parsedInput.invalidLines.length > 1 ? "s" : ""} ${parsedInput.invalidLines.join(", ")}. Use FirstName,email@example.com`,
      );
      return;
    }

    startSubmitTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/recipients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipients: parsedInput.recipients.map((recipient) => ({
                email: recipient.email,
                firstName: recipient.firstName,
              })),
            }),
          });

          const data = (await response.json()) as { message?: string; error?: string };
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to add recipients.");
          }

          setBulkAddInput("");
          setStatusMessage(
            data.message ?? `Saved ${parsedInput.recipients.length} recipients.`,
          );
          await refreshAll();
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to add recipients.");
        }
      })();
    });
  }

  async function handleDeleteRecipient(recipientId: string) {
    setStatusMessage(null);
    setErrorMessage(null);

    startSubmitTransition(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/recipients?id=${recipientId}`, {
            method: "DELETE",
          });

          const data = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to delete recipient.");
          }

          setStatusMessage("Recipient removed.");
          await refreshAll();
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to delete recipient.",
          );
        }
      })();
    });
  }

  async function handleSendEmails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    setLastSend(null);

    if (!subject.trim() || !body.trim()) {
      setErrorMessage("Subject and body are required.");
      return;
    }

    if (selectedIds.length === 0) {
      setErrorMessage("Select at least one recipient.");
      return;
    }

    startSubmitTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject,
              body,
              recipientIds: selectedIds,
            }),
          });

          const data = (await response.json()) as SendResult & { error?: string };
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to send emails.");
          }

          setLastSend(data);
          setStatusMessage(
            `Campaign sent. ${data.sentCount} succeeded, ${data.failedCount} failed.`,
          );

          startRefreshTransition(() => {
            void refreshAll().catch((error) => {
              setErrorMessage(
                error instanceof Error
                  ? error.message
                  : "Sent emails but failed to refresh dashboard.",
              );
            });
          });
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to send emails.");
        }
      })();
    });
  }

  function setDomainSelected(domainRecipients: Recipient[], checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        const next = new Set(current);
        for (const recipient of domainRecipients) {
          next.add(recipient.id);
        }
        return Array.from(next);
      }

      const domainIds = new Set(domainRecipients.map((recipient) => recipient.id));
      return current.filter((id) => !domainIds.has(id));
    });
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] p-6 shadow-[0_18px_70px_rgba(31,28,23,0.08)] backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                Gmail Agent
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
                Bulk Email Sender
              </h1>
            </div>
            <button
              type="button"
              onClick={() =>
                startRefreshTransition(() => {
                  void refreshAll().catch((error) => {
                    setErrorMessage(
                      error instanceof Error ? error.message : "Failed to refresh data.",
                    );
                  });
                })
              }
              className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-[var(--ink)] transition hover:bg-neutral-50 disabled:opacity-60"
              disabled={isRefreshing || isLoading}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {(statusMessage || errorMessage) && (
          <section
            className={`rounded-2xl border p-4 text-sm ${
              errorMessage
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {errorMessage ?? statusMessage}
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
          <section className="rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] p-5 shadow-[0_12px_45px_rgba(31,28,23,0.06)] backdrop-blur">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Recipients</h2>
                  <p className="text-sm text-[var(--muted)]">
                    {recipients.length} saved in Postgres
                  </p>
                </div>
                <div className="w-full sm:max-w-52">
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Search
                  </label>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="email, first name, or domain"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none ring-0 placeholder:text-neutral-400 focus:border-[var(--brand-2)]"
                  />
                </div>
              </div>

              <form onSubmit={handleAddRecipients} className="rounded-2xl border border-[var(--line)] bg-white/85 p-4">
                  <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                  Add Recipients (one per line: FirstName,email)
                </label>
                <textarea
                  value={bulkAddInput}
                  onChange={(event) => setBulkAddInput(event.target.value)}
                  rows={4}
                  placeholder={"Alice,alice@example.com\nBob,bob@example.com"}
                  className="w-full resize-y rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-2)]"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--muted)]">
                    <code className="rounded bg-white px-1 py-0.5">{"{{name}}"}</code> uses the
                    saved first name. Duplicate emails are skipped.
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-full bg-[var(--brand)] px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {isSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        const next = new Set(selectedIds);
                        for (const recipient of filteredRecipients) {
                          next.add(recipient.id);
                        }
                        setSelectedIds(Array.from(next));
                        return;
                      }

                      setSelectedIds((current) =>
                        current.filter(
                          (id) => !filteredRecipients.some((recipient) => recipient.id === id),
                        ),
                      );
                    }}
                    className="h-4 w-4 rounded border-neutral-300 accent-[var(--brand)]"
                  />
                  Select all filtered
                </label>
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                  {selectedCount} selected
                </span>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-white/75 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">Company Domains</p>
                    <p className="text-xs text-[var(--muted)]">
                      View recipients grouped by domain and select them in bulk.
                    </p>
                  </div>
                  {activeDomainFilter && (
                    <button
                      type="button"
                      onClick={() => setActiveDomainFilter(null)}
                      className="rounded-full border border-[var(--line)] bg-white px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-neutral-50"
                    >
                      Clear Domain Filter
                    </button>
                  )}
                </div>

                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {!isLoading && visibleDomainGroups.length === 0 && (
                    <p className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
                      No domain groups match the current filters.
                    </p>
                  )}

                  {visibleDomainGroups.map((group) => {
                    const domainSelectedCount = group.recipients.filter((recipient) =>
                      selectedIdSet.has(recipient.id),
                    ).length;
                    const allDomainSelected =
                      group.recipients.length > 0 &&
                      domainSelectedCount === group.recipients.length;

                    return (
                      <details
                        key={group.domain}
                        className={`rounded-xl border p-3 ${
                          activeDomainFilter === group.domain
                            ? "border-emerald-300 bg-emerald-50/60"
                            : "border-[var(--line)] bg-white"
                        }`}
                      >
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allDomainSelected}
                              onChange={(event) =>
                                setDomainSelected(group.recipients, event.target.checked)
                              }
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 accent-[var(--brand)]"
                              aria-label={`Select all recipients for ${group.domain}`}
                            />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setActiveDomainFilter((current) =>
                                  current === group.domain ? null : group.domain,
                                );
                              }}
                              className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
                                activeDomainFilter === group.domain
                                  ? "bg-emerald-600 text-white"
                                  : "border border-[var(--line)] bg-white text-[var(--ink)]"
                              }`}
                            >
                              {activeDomainFilter === group.domain ? "Showing" : "Filter"}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                                {group.domain}
                              </p>
                              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                                {group.recipients.length} recipient
                                {group.recipients.length === 1 ? "" : "s"} • {domainSelectedCount} selected
                              </p>
                            </div>
                          </div>
                        </summary>

                        <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-3">
                          {group.recipients.map((recipient) => (
                            <label
                              key={recipient.id}
                              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
                            >
                              <input
                                type="checkbox"
                                checked={selectedIdSet.has(recipient.id)}
                                onChange={(event) =>
                                  setSelectedIds((current) =>
                                    event.target.checked
                                      ? Array.from(new Set([...current, recipient.id]))
                                      : current.filter((id) => id !== recipient.id),
                                  )
                                }
                                className="h-4 w-4 accent-[var(--brand)]"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
                                {recipient.email}
                              </span>
                              <span className="truncate text-xs text-[var(--muted)]">
                                {recipient.name || "No first name"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                {isLoading && <p className="text-sm text-[var(--muted)]">Loading recipients...</p>}
                {!isLoading && filteredRecipients.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                    No recipients yet. Add email addresses above.
                  </p>
                )}
                {filteredRecipients.map((recipient) => {
                  const checked = selectedIds.includes(recipient.id);
                  return (
                    <label
                      key={recipient.id}
                      className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                        checked
                          ? "border-emerald-300 bg-emerald-50/70"
                          : "border-[var(--line)] bg-white/70 hover:bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, recipient.id]))
                              : current.filter((id) => id !== recipient.id),
                          );
                        }}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {recipient.email}
                        </p>
                        <p className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                          {recipient.name || "No first name"} • Added {" "}
                          {new Date(recipient.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete ${recipient.email}?`)) {
                            void handleDeleteRecipient(recipient.id);
                          }
                        }}
                        className="rounded-full border border-red-200 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--danger)] hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </label>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] p-5 shadow-[0_12px_45px_rgba(31,28,23,0.06)] backdrop-blur">
              <form onSubmit={handleSendEmails} className="space-y-4">
                <div>
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Subject
                  </label>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Quick intro from my team"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-2)]"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Body
                  </label>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={10}
                    placeholder={"I wanted to reach out about...\n\nHere is the main message content."}
                    className="w-full resize-y rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-2)]"
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[var(--muted)]">
                    Sending to <span className="font-semibold text-[var(--ink)]">{selectedCount}</span>{" "}
                    recipient{selectedCount === 1 ? "" : "s"}
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting || selectedCount === 0}
                    className="rounded-full bg-[var(--brand-2)] px-5 py-2.5 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {isSubmitting ? "Sending..." : "Send Individually"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] p-5 shadow-[0_12px_45px_rgba(31,28,23,0.06)] backdrop-blur">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">Recent Campaigns</h2>
                <p className="text-sm text-[var(--muted)]">
                  Delivery logs stored in Postgres.
                </p>
              </div>

              {lastSend && (
                <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-900">
                    Latest send: {lastSend.sentCount} sent / {lastSend.failedCount} failed
                  </p>
                  <div className="mt-2 max-h-36 space-y-1 overflow-auto pr-1">
                    {lastSend.results.map((result) => (
                      <p
                        key={`${lastSend.campaignId}-${result.recipientId}`}
                        className={`text-xs ${
                          result.status === "SENT" ? "text-emerald-800" : "text-red-700"
                        }`}
                      >
                        {result.email}: {result.status}
                        {result.error ? ` (${result.error})` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {campaigns.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                    No campaigns yet.
                  </p>
                )}

                {campaigns.map((campaign) => {
                  const sent = campaign.deliveries.filter((item) => item.status === "SENT").length;
                  const failed = campaign.deliveries.filter((item) => item.status === "FAILED").length;

                  return (
                    <div key={campaign.id} className="rounded-2xl border border-[var(--line)] bg-white/75 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{campaign.subject}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">
                            {campaign.body.length > 180
                              ? `${campaign.body.slice(0, 180)}...`
                              : campaign.body}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                          {new Date(campaign.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                          Sent: {sent}
                        </span>
                        <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
                          Failed: {failed}
                        </span>
                        <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                          Total: {campaign.deliveries.length}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
