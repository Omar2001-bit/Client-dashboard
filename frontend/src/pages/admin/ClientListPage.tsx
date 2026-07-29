import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Button,
  Input,
  StatusBadge,
  TableContainer,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { Plus, Search } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import type { ClientDoc } from "@/types";

export function ClientListPage() {
  const currentRole = useAuthStore((s) => s.role);
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getDocs(collection(db, "clients"))
      .then((snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc))))
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.contactEmail.toLowerCase().includes(search.toLowerCase())
  );

  const colCount = currentRole === "executiveAdmin" ? 6 : 5;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Clients</h1>
        <Link to="/admin/clients/new">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New User
          </Button>
        </Link>
      </div>

      <div className="relative max-w-sm" data-tutorial="admin-clients-search">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40 z-10" />
        <Input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <TableContainer data-tutorial="admin-clients-table">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Company</TH>
              <TH>Contact</TH>
              <TH>Status</TH>
              <TH>Engagement</TH>
              {currentRole === "executiveAdmin" && <TH data-tutorial="admin-client-paid">Client Paid</TH>}
              <TH />
            </TR>
          </THead>
          <TBody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TR key={i} className="hover:bg-transparent">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <TD key={j}>
                        <Skeleton className="h-4" />
                      </TD>
                    ))}
                  </TR>
                ))
              : filtered.map((client) => (
                  <TR key={client.id}>
                    <TD className="font-medium text-ink">{client.name}</TD>
                    <TD>
                      <div>{client.contactName}</div>
                      <div className="text-xs text-ink/40">{client.contactEmail}</div>
                    </TD>
                    <TD>
                      <StatusBadge status={client.status} />
                    </TD>
                    <TD>
                      {client.contractStartDate?.toDate().toLocaleDateString()}
                      {client.contractEndDate
                        ? ` to ${client.contractEndDate.toDate().toLocaleDateString()}`
                        : ""}
                    </TD>
                    {currentRole === "executiveAdmin" && (
                      <TD>USD {(client.servicePrice ?? client.agencyFee)?.toLocaleString()}</TD>
                    )}
                    <TD className="text-right space-x-3">
                      {currentRole === "executiveAdmin" && (
                        <Link
                          to={`/admin/clients/${client.id}/preview`}
                          className="text-xs text-ink/50 hover:text-ink"
                        >
                          Preview
                        </Link>
                      )}
                      <Link
                        to={`/admin/clients/${client.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </Link>
                    </TD>
                  </TR>
                ))}
          </TBody>
        </Table>
        {!loading && filtered.length === 0 && (
          <EmptyState
            className="py-16"
            title={search ? "No clients match your search." : "No clients yet."}
          />
        )}
      </TableContainer>
    </div>
  );
}
