import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { KPICard } from "@/components/ui/KPICard";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
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
          <h1 className="text-2xl font-bold text-gray-900">Agency Overview</h1>
          <p className="text-gray-500 text-sm mt-1">All clients at a glance</p>
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
          <h2 className="font-semibold text-gray-900">Client Roster</h2>
          <Link to="/admin/clients" className="text-sm text-brand-600 hover:underline">
            Manage all
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-6 py-3">Client</th>
                <th className="text-left px-6 py-3">Contact</th>
                <th className="text-left px-6 py-3">Status</th>
                <th className="text-left px-6 py-3">Contract Start</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-6 py-4" colSpan={5}>
                        <div className="animate-pulse h-4 bg-gray-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                : clients.map((client) => (
                    <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{client.name}</td>
                      <td className="px-6 py-4 text-gray-500">{client.contactEmail}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={client.status} />
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {client.contractStartDate?.toDate().toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`/admin/clients/${client.id}`}
                          className="text-brand-600 hover:underline text-xs font-medium"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && clients.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="font-medium">No clients yet</p>
              <p className="text-sm mt-1">
                <Link to="/admin/clients/new" className="text-brand-600 hover:underline">
                  Add your first client
                </Link>
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
