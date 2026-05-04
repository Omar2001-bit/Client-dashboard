import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
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

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <Link to="/admin/clients/new">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New User
          </Button>
        </Link>
      </div>

      <div className="relative max-w-sm" data-tutorial="admin-clients-search">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200 w-full"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-tutorial="admin-clients-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left px-6 py-3">Company</th>
              <th className="text-left px-6 py-3">Contact</th>
              <th className="text-left px-6 py-3">Status</th>
              <th className="text-left px-6 py-3">Engagement</th>
              {currentRole === "executiveAdmin" && <th className="text-left px-6 py-3" data-tutorial="admin-client-paid">Client Paid</th>}
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: currentRole === "executiveAdmin" ? 6 : 5 }).map((__, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="animate-pulse h-4 bg-gray-100 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.map((client) => (
                  <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{client.name}</td>
                    <td className="px-6 py-4 text-gray-500">
                      <div>{client.contactName}</div>
                      <div className="text-xs text-gray-400">{client.contactEmail}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={client.status} />
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {client.contractStartDate?.toDate().toLocaleDateString()}
                      {client.contractEndDate ? ` to ${client.contractEndDate.toDate().toLocaleDateString()}` : ""}
                    </td>
                    {currentRole === "executiveAdmin" && (
                      <td className="px-6 py-4 text-gray-500">
                        USD {(client.servicePrice ?? client.agencyFee)?.toLocaleString()}
                      </td>
                    )}
                    <td className="px-6 py-4 text-right space-x-3">
                      <Link to={`/admin/clients/${client.id}/preview`} className="text-xs text-gray-500 hover:text-gray-700">
                        Preview
                      </Link>
                      <Link to={`/admin/clients/${client.id}`} className="text-xs text-brand-600 hover:underline font-medium">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p>{search ? "No clients match your search." : "No clients yet."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
