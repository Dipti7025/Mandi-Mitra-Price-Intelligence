import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminCatalogQueryKey,
  getGetAdminUsersQueryKey,
  useCreateAdminCatalogEntry,
  useGetAdminCatalog,
  useGetAdminUsers,
  useUpdateAdminCatalogEntry,
} from "@workspace/api-client-react";
import type { AdminCatalogEntry, AdminCatalogInput } from "@workspace/api-client-react";
import { Check, Pencil, Plus, RefreshCw, X } from "lucide-react";

type CatalogType = AdminCatalogEntry["type"];
const catalogTypeLabels: Record<CatalogType, string> = {
  commodity: "Commodity",
  state: "State",
  mandi: "Mandi",
  variety: "Variety",
};

export default function AdminCatalogPanel() {
  const queryClient = useQueryClient();
  const catalog = useGetAdminCatalog({ query: { queryKey: getGetAdminCatalogQueryKey() } });
  const users = useGetAdminUsers({ query: { queryKey: getGetAdminUsersQueryKey() } });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetAdminCatalogQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() });
    void queryClient.invalidateQueries();
  };
  const create = useCreateAdminCatalogEntry({ mutation: { onSuccess: refresh } });
  const update = useUpdateAdminCatalogEntry({ mutation: { onSuccess: refresh } });
  const [type, setType] = useState<CatalogType>("commodity");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stateId, setStateId] = useState("");
  const [commodityId, setCommodityId] = useState("");
  const [mandiId, setMandiId] = useState("");
  const [editing, setEditing] = useState<AdminCatalogEntry | null>(null);
  const [editName, setEditName] = useState("");
  const entries = catalog.data ?? [];
  const states = entries.filter((entry) => entry.type === "state");
  const commodities = entries.filter((entry) => entry.type === "commodity" && entry.enabled);
  const mandis = entries.filter((entry) => entry.type === "mandi" && entry.enabled);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: AdminCatalogInput = {
      type,
      name: name.trim(),
      ...(type === "state" ? { code: code.trim() } : {}),
      ...(type === "mandi" ? { stateId } : {}),
      ...(type === "variety" ? { commodityId, mandiId } : {}),
    };
    create.mutate({ data }, {
      onSuccess: () => {
        setName("");
        setCode("");
        setStateId("");
        setCommodityId("");
        setMandiId("");
      },
    });
  };

  const saveName = (entry: AdminCatalogEntry) => {
    if (!editName.trim()) return;
    update.mutate({
      entityType: entry.type,
      entityId: entry.id,
      data: { name: editName.trim() },
    }, { onSuccess: () => setEditing(null) });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel p-5 md:p-6" aria-labelledby="admin-catalog-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Market structure</div>
            <h2 id="admin-catalog-heading" className="display-type text-2xl font-extrabold">Commodities and mandis</h2>
            <p className="mt-1 text-sm text-muted-foreground">Add or rename catalog entries. Disable a commodity or mandi to remove it from farmer-facing choices.</p>
          </div>
          {catalog.isFetching && <RefreshCw className="mt-1 animate-spin text-primary" size={17} aria-label="Refreshing catalog"/>}
        </div>

        <form onSubmit={submit} className="mt-5 grid gap-3 rounded-xl bg-secondary/50 p-4 sm:grid-cols-2" data-testid="admin-catalog-form">
          <label>
            <span className="field-label">Add</span>
            <select className="field-control" value={type} onChange={(event) => setType(event.target.value as CatalogType)} data-testid="admin-catalog-type">
              {Object.entries(catalogTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Name</span>
            <input className="field-control" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={type === "commodity" ? "e.g. Tomato" : type === "state" ? "e.g. Karnataka" : type === "mandi" ? "e.g. Hubballi" : "e.g. Red"} data-testid="admin-catalog-name"/>
          </label>
          {type === "state" && <label><span className="field-label">State code</span><input className="field-control" required maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. KA" data-testid="admin-catalog-code"/></label>}
          {type === "mandi" && <label><span className="field-label">State</span><select className="field-control" required value={stateId} onChange={(event) => setStateId(event.target.value)} data-testid="admin-catalog-state"><option value="">Choose state</option>{states.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
          {type === "variety" && <>
            <label><span className="field-label">Commodity</span><select className="field-control" required value={commodityId} onChange={(event) => setCommodityId(event.target.value)} data-testid="admin-catalog-commodity"><option value="">Choose commodity</option>{commodities.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label><span className="field-label">Mandi</span><select className="field-control" required value={mandiId} onChange={(event) => setMandiId(event.target.value)} data-testid="admin-catalog-mandi"><option value="">Choose mandi</option>{mandis.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          </>}
          <button disabled={create.isPending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60 sm:col-span-2" data-testid="button-create-catalog">
            <Plus size={15}/>{create.isPending ? "Saving…" : `Add ${catalogTypeLabels[type].toLowerCase()}`}
          </button>
          {create.isError && <p role="alert" className="text-sm text-destructive sm:col-span-2">Could not add this entry. Check for a duplicate name or missing selection.</p>}
        </form>

        {catalog.isLoading ? <p className="mt-5 text-sm text-muted-foreground">Loading catalog…</p>
          : catalog.isError ? <p role="alert" className="mt-5 text-sm text-destructive">Catalog could not be loaded.</p>
            : !entries.length ? <p className="mt-5 text-sm text-muted-foreground">No catalog entries are available.</p>
              : <div className="mt-5 max-h-[480px] space-y-2 overflow-auto pr-1">
                {entries.map((entry) => {
                  const relationship = entry.type === "mandi"
                    ? states.find((state) => state.id === entry.stateId)?.name
                    : entry.type === "variety"
                      ? `${commodities.find((item) => item.id === entry.commodityId)?.name ?? "Commodity"} · ${mandis.find((item) => item.id === entry.mandiId)?.name ?? "Mandi"}`
                      : entry.code ?? null;
                  return <article key={`${entry.type}-${entry.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-3" data-testid={`catalog-entry-${entry.type}-${entry.id}`}>
                    <div className="min-w-0 flex-1">
                      {editing?.id === entry.id && editing.type === entry.type
                        ? <form onSubmit={(event) => { event.preventDefault(); saveName(entry); }} className="flex gap-2">
                          <input className="field-control min-h-10" autoFocus maxLength={80} value={editName} onChange={(event) => setEditName(event.target.value)} aria-label={`Rename ${entry.name}`}/>
                          <button type="submit" disabled={update.isPending} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground" aria-label="Save name" data-testid={`button-save-catalog-${entry.id}`}><Check size={16}/></button>
                          <button type="button" onClick={() => setEditing(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border" aria-label="Cancel rename"><X size={16}/></button>
                        </form>
                        : <><p className="truncate font-bold">{entry.name}</p><p className="mt-0.5 text-xs capitalize text-muted-foreground">{catalogTypeLabels[entry.type]}{relationship ? ` · ${relationship}` : ""}</p></>}
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.type !== "state" && entry.type !== "variety" && <button
                        type="button"
                        onClick={() => update.mutate({ entityType: entry.type, entityId: entry.id, data: { enabled: !entry.enabled } })}
                        disabled={update.isPending}
                        className={`min-h-9 rounded-lg px-3 text-xs font-bold ${entry.enabled ? "bg-secondary text-primary" : "border border-border text-muted-foreground"}`}
                        data-testid={`button-toggle-catalog-${entry.id}`}
                      >{entry.enabled ? "Enabled" : "Disabled"}</button>}
                      {editing?.id !== entry.id && <button type="button" onClick={() => { setEditing(entry); setEditName(entry.name); }} className="grid h-9 w-9 place-items-center rounded-lg border border-border" aria-label={`Rename ${entry.name}`} data-testid={`button-edit-catalog-${entry.id}`}><Pencil size={15}/></button>}
                    </div>
                  </article>;
                })}
              </div>}
        {update.isError && <p role="alert" className="mt-3 text-sm text-destructive">Catalog update failed.</p>}
      </section>

      <section className="panel p-5 md:p-6" aria-labelledby="admin-users-heading">
        <div className="eyebrow">Accounts</div>
        <h2 id="admin-users-heading" className="display-type text-2xl font-extrabold">Registered users</h2>
        <p className="mt-1 text-sm text-muted-foreground">Phone numbers are visible only in this protected admin view.</p>
        {users.isLoading ? <p className="mt-5 text-sm text-muted-foreground">Loading users…</p>
          : users.isError ? <p role="alert" className="mt-5 text-sm text-destructive">Registered users could not be loaded.</p>
            : !users.data?.length ? <p className="mt-5 text-sm text-muted-foreground">No users have registered yet.</p>
              : <div className="mt-5 max-h-[480px] space-y-2 overflow-auto pr-1">
                {users.data.map((user) => <article key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-3" data-testid={`admin-user-${user.id}`}>
                  <div><p className="font-bold">{user.name || user.phone}</p>{user.name && <p className="text-xs text-muted-foreground">{user.phone}</p>}<p className="mt-0.5 text-xs text-muted-foreground">Joined {new Date(user.createdAt).toLocaleDateString("en-IN")}</p></div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold capitalize text-secondary-foreground">{user.role}{!user.enabled ? " · disabled" : ""}</span>
                </article>)}
              </div>}
      </section>
    </div>
  );
}