import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { KPICard } from "@/components/ui/KPICard";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Table, THead, TBody, TR, TH, TD, EmptyState, Skeleton } from "@/components/ui";
import { Users, TrendingUp, FlaskConical, Plus } from "lucide-react";
import type { ClientDoc } from "@/types";

export function AdminHomePage() {
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(query(collection(db, "clients")))
      .then((snap) => {
        setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc)));
      })
      .finally(() => setLoading(false));
  }, []);

  const activeClients = clients.filter((c) => c.status === "active");

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Agency Overview</h1>
          <p className="text-ink/50 text-sm mt-1">All clients at a glance</p>
        </div>
        <Link to="/admin/clients/new" data-tutorial="admin-new-client">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New User
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6" data-tutorial="admin-kpi-cards">
        <KPICard
          title="Active Clients"
          value={String(activeClients.length)}
          icon={<Users className="h-5 w-5" />}
          loading={loading}
        />
        <KPICard
          title="Total Clients"
          value={String(clients.length)}
          icon={<TrendingUp className="h-5 w-5" />}
          loading={loading}
        />
        <KPICard
          title="Inactive Clients"
          value={String(clients.filter((c) => c.status === "inactive").length)}
          icon={<FlaskConical className="h-5 w-5" />}
          loading={loading}
        />
      </div>

      <Card data-tutorial="admin-client-roster">
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Client Roster</h2>
          <Link to="/admin/clients" className="text-sm text-brand-600 hover:underline">
            Manage all
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Client</TH>
                <TH>Contact</TH>
                <TH>Status</TH>
                <TH>Contract Start</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TR key={i} className="hover:bg-transparent">
                      <TD colSpan={5}>
                        <Skeleton className="h-4 w-full" />
                      </TD>
                    </TR>
                  ))
                : clients.map((client) => (
                    <TR key={client.id}>
                      <TD className="font-medium text-ink">{client.name}</TD>
                      <TD>{client.contactEmail}</TD>
                      <TD>
                        <StatusBadge status={client.status} />
                      </TD>
                      <TD>{client.contractStartDate?.toDate().toLocaleDateString()}</TD>
                      <TD className="text-right">
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
          {!loading && clients.length === 0 && (
            <EmptyState
              className="py-12"
              title="No clients yet"
              action={
                <Link to="/admin/clients/new" className="text-sm text-brand-600 hover:underline">
                  Add your first client
                </Link>
              }
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
